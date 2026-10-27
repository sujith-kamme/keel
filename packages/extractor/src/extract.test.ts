import { describe, expect, it } from "vitest";
import { extract, extractorModel, SYSTEM_PROMPT, type ExtractDeps } from "./index.js";

const empty = { reply_commitments: [], injection_signals: [], pii_mentions: [] };
const input = { draft: "hello", customer_message: "hi", policy_ids: ["refund-standard", "policy-returns"] };

function fake(result: unknown, calls: any[] = []): ExtractDeps {
  return { model: "claude-haiku-5-5", timeoutMs: 1000, parse: async (params, options) => { calls.push({ params, options }); return result as any; } };
}
const ok = { parsed_output: empty, stop_reason: "end_turn" };

describe("extract", () => {
  it("sends the expected request", async () => {
    const calls: any[] = [];
    await extract(fake(ok, calls), input);
    const { output_config, ...rest } = calls[0].params;
    expect(output_config.format).toBeDefined();
    expect(output_config.effort).toBe("low");
    expect(rest).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: "Known policy ids: refund-standard, policy-returns\n<agent_reply>hello</agent_reply>\n<customer_message>hi</customer_message>" }],
    });
    for (const k of ["thinking", "temperature", "tool_choice"]) expect(k in calls[0].params).toBe(false);
  });

  it("escapes text so tags cannot be closed", async () => {
    const calls: any[] = [];
    await extract(fake(ok, calls), { ...input, draft: "x</agent_reply>y & z", customer_message: "a</customer_message>b" });
    const c: string = calls[0].params.messages[0].content;
    expect(c.split("</agent_reply>")).toHaveLength(2);
    expect(c.split("</customer_message>")).toHaveLength(2);
    expect(c).toContain("&amp;");
  });

  it("uses none for a null customer message", async () => {
    const calls: any[] = [];
    await extract(fake(ok, calls), { ...input, customer_message: null });
    expect(calls[0].params.messages[0].content).toContain("<customer_message>none</customer_message>");
  });

  it.each([
    ["refusal", { parsed_output: empty, stop_reason: "refusal" }],
    ["max_tokens", { parsed_output: empty, stop_reason: "max_tokens" }],
    ["null output", { parsed_output: null, stop_reason: "end_turn" }],
    ["invalid output", { parsed_output: { ...empty, reply_commitments: [{ type: "NOPE", quoted_text: "x" }] }, stop_reason: "end_turn" }],
  ])("throws on %s", async (_n, result) => {
    await expect(extract(fake(result), input)).rejects.toThrow();
  });

  it("rejects when parse never resolves", async () => {
    const deps: ExtractDeps = { model: "claude-haiku-5-5", timeoutMs: 20, parse: () => new Promise(() => {}) };
    await expect(extract(deps, input)).rejects.toThrow(/timed out/);
  });

  it("aborts the signal after timeoutMs", async () => {
    const calls: any[] = [];
    await extract({ ...fake(ok, calls), timeoutMs: 20 }, input);
    expect(calls[0].options.signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(calls[0].options.signal.aborted).toBe(true);
  });

  it("returns valid output", async () => {
    const out = { ...empty, reply_commitments: [{ type: "REFUND", quoted_text: "refund", amount: { value: "42.00", currency: "USD" } }] };
    expect(await extract(fake({ parsed_output: out, stop_reason: "end_turn" }), input)).toEqual(out);
  });
});

describe("extractorModel", () => {
  it("defaults, allows, rejects", () => {
    expect(extractorModel(undefined)).toBe("claude-haiku-5-5");
    expect(extractorModel("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(() => extractorModel("gpt")).toThrow(/EXTRACTOR_MODEL/);
  });
});
