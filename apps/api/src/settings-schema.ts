import { AGENT_MODELS, PROMPT_MODES, agentModel, promptMode } from "@keel/agent";
import { EXTRACTOR_MODELS, extractorModel } from "@keel/extractor";
import { CUSTOMER_MODELS, customerModel } from "@keel/gauntlet";
import { riskConfig } from "@keel/risk";
import { gauntletConcurrency } from "@keel/worker/gauntlet";
import { HOOK_PREFIX, notifyConfig } from "@keel/worker/notify";
import { z } from "zod";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const guardSchema = z.strictObject({
  extractor_model: z.enum(EXTRACTOR_MODELS),
  extractor_timeout_ms: int(1000, 10000),
  risk_threshold: int(1, 100),
  risk_half_life_min: int(1, 1440),
});
export const agentSchema = z.strictObject({
  agent_model: z.enum(AGENT_MODELS),
  agent_prompt: z.enum(PROMPT_MODES),
});
export const gauntletSchema = z.strictObject({
  gauntlet_customer_model: z.enum(CUSTOMER_MODELS),
  gauntlet_concurrency: int(1, 10),
});
export const disputesSchema = z.strictObject({
  dispute_auto_submit: z.boolean(),
  dispute_poll_seconds: int(30, 3600),
});
export const zapierSchema = z.strictObject({
  zapier_hook_url: z.string().startsWith(HOOK_PREFIX).nullable(),
});

export const SECTION_SCHEMAS = {
  guard: guardSchema,
  agent: agentSchema,
  gauntlet: gauntletSchema,
  disputes: disputesSchema,
  zapier: zapierSchema,
} as const;
export type Section = keyof typeof SECTION_SCHEMAS;

export const settingsSchema = z.strictObject({
  ...guardSchema.shape,
  ...agentSchema.shape,
  ...gauntletSchema.shape,
  ...disputesSchema.shape,
  ...zapierSchema.shape,
});
export type Settings = z.infer<typeof settingsSchema>;

export const SECTIONS = Object.fromEntries(
  Object.entries(SECTION_SCHEMAS).map(([name, schema]) => [name, Object.keys(schema.shape)]),
) as Record<Section, string[]>;

export const SETTINGS_DEFAULTS: Settings = {
  extractor_model: "claude-haiku-5-5",
  extractor_timeout_ms: 4000,
  risk_threshold: 60,
  risk_half_life_min: 30,
  agent_model: "claude-haiku-5-5",
  agent_prompt: "lenient",
  gauntlet_customer_model: "claude-haiku-5-5",
  gauntlet_concurrency: 6,
  dispute_auto_submit: false,
  dispute_poll_seconds: 120,
  zapier_hook_url: null,
};

/** First-boot defaults from env. An invalid value throws (fail fast, as the old module-load reads did). */
export function settingsFromEnv(env: Record<string, string | undefined>): Settings {
  const risk = riskConfig(env);
  return settingsSchema.parse({
    extractor_model: extractorModel(env.EXTRACTOR_MODEL),
    extractor_timeout_ms: Number(env.EXTRACTOR_TIMEOUT_MS ?? SETTINGS_DEFAULTS.extractor_timeout_ms),
    risk_threshold: risk.threshold,
    risk_half_life_min: risk.half_life_min,
    agent_model: agentModel(env.DEMO_AGENT_MODEL),
    agent_prompt: promptMode(env.DEMO_AGENT_PROMPT),
    gauntlet_customer_model: customerModel(env.GAUNTLET_CUSTOMER_MODEL),
    gauntlet_concurrency: gauntletConcurrency(env.GAUNTLET_CONCURRENCY),
    dispute_auto_submit: env.DISPUTE_AUTO_SUBMIT === "true",
    dispute_poll_seconds: Number(env.DISPUTE_POLL_SECONDS ?? SETTINGS_DEFAULTS.dispute_poll_seconds),
    zapier_hook_url: notifyConfig(env).hookUrl,
  });
}
