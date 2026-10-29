import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Extraction } from "@keel/core";
import { SYSTEM_PROMPT } from "./prompt";

export const EXTRACTOR_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export type ExtractorModel = (typeof EXTRACTOR_MODELS)[number];

/** EXTRACTOR_MODEL, default Haiku 5.5. Unknown values throw so a typo fails at startup. */
export function extractorModel(value: string | undefined): ExtractorModel {
  const model = value ?? "claude-haiku-5-5";
  if (!(EXTRACTOR_MODELS as readonly string[]).includes(model)) throw new Error(`EXTRACTOR_MODEL must be one of ${EXTRACTOR_MODELS.join(", ")}`);
  return model as ExtractorModel;
}

export interface ExtractDeps {
  parse: (
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { signal: AbortSignal },
  ) => Promise<{ parsed_output: unknown; stop_reason: string | null }>;
  model: ExtractorModel;
  timeoutMs: number;
}
export interface ExtractInput { draft: string; customer_message: string | null; policy_ids: string[] }

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Throws on timeout, refusal, max_tokens or output failing `Extraction`. Callers treat any throw as EXTRACTOR_UNAVAILABLE. */
export async function extract(deps: ExtractDeps, input: ExtractInput): Promise<Extraction> {
  const content = `Known policy ids: ${input.policy_ids.join(", ")}\n<agent_reply>${escape(input.draft)}</agent_reply>\n<customer_message>${escape(input.customer_message ?? "none")}</customer_message>`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`extractor timed out after ${deps.timeoutMs}ms`)), deps.timeoutMs);
  });
  try {
    const res = await Promise.race([
      deps.parse(
        {
          model: deps.model,
          max_tokens: 2048,
          output_config: { effort: "low", format: zodOutputFormat(Extraction) },
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        },
        { signal: AbortSignal.timeout(deps.timeoutMs) },
      ),
      timeout,
    ]);
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`extractor stopped: ${res.stop_reason}`);
    if (res.parsed_output == null) throw new Error("extractor returned no parsed output");
    return Extraction.parse(res.parsed_output);
  } finally {
    clearTimeout(timer);
  }
}
