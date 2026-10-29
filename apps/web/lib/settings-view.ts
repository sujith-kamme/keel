import { AGENT_MODELS, PROMPT_MODES } from "@keel/agent";
import { EXTRACTOR_MODELS } from "@keel/extractor";
import { CUSTOMER_MODELS } from "@keel/gauntlet";
import { z } from "zod";
import type { Rule } from "./policies-view";

// Mirrors apps/api/src/settings-schema.ts (that module pulls in worker code, so it is not imported here).
// The API validates again; these keep a bad value from making the round trip. apps/api/src/web-mirror.test.ts checks they match.
const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** worker notify's HOOK_PREFIX: the API only stores (and the worker only posts to) Zapier hook URLs. */
export const HOOK_PREFIX = "https://hooks.zapier.com/";

export const SECTION_SCHEMAS = {
  guard: z.strictObject({
    extractor_model: z.enum(EXTRACTOR_MODELS),
    extractor_timeout_ms: int(1000, 10000),
    risk_threshold: int(1, 100),
    risk_half_life_min: int(1, 1440),
  }),
  agent: z.strictObject({ agent_model: z.enum(AGENT_MODELS), agent_prompt: z.enum(PROMPT_MODES) }),
  gauntlet: z.strictObject({ gauntlet_customer_model: z.enum(CUSTOMER_MODELS), gauntlet_concurrency: int(1, 10) }),
  disputes: z.strictObject({ dispute_auto_submit: z.boolean(), dispute_poll_seconds: int(30, 3600) }),
  zapier: z.strictObject({ zapier_hook_url: z.string().trim().max(2048).startsWith(HOOK_PREFIX).nullable() }),
} as const;
export type Section = keyof typeof SECTION_SCHEMAS;

export const isSection = (s: unknown): s is Section => typeof s === "string" && Object.hasOwn(SECTION_SCHEMAS, s);

/** A section's full set of values, parsed; null when anything is missing, extra or out of range. */
export function sectionValues(section: Section, values: unknown): Record<string, unknown> | null {
  const r = SECTION_SCHEMAS[section].safeParse(values);
  return r.success ? r.data : null;
}

export function sectionProblem(section: Section): string {
  return section === "zapier" ? `The hook URL must start with ${HOOK_PREFIX}` : "Check the values: one is missing or out of range.";
}

export function settingsErrorMessage(status: number): string {
  if (status === 400) return "Check the values: one is missing or out of range.";
  if (status === 500) return "Couldn't save the settings. Try again.";
  return `Request failed (${status}).`;
}

/** POST /v1/settings/zapier/test → an inline line. Never includes the hook URL. */
export function zapierTestMessage(r: { ok: boolean; status: number | null }): string {
  return r.status === null ? "Couldn't reach Zapier" : `Zapier answered ${r.status}`;
}

export function zapierTestError(status: number): string {
  return status === 409 ? "No hook is saved." : `Request failed (${status}).`;
}

export const ConsoleEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));

export function emailErrorMessage(status: number): string {
  return status === 400 ? "Enter a valid email address." : `Request failed (${status}).`;
}

/** The API's Password rule (12 to 128 characters), plus confirmation and "different from the current one". */
export function passwordProblem(current: unknown, next: unknown, confirm: unknown): string | null {
  if (typeof current !== "string" || typeof next !== "string" || typeof confirm !== "string") return "Invalid request.";
  if (current.length === 0 || current.length > 128) return "Enter your current password.";
  if (next.length < 12 || next.length > 128) return "The new password must be 12 to 128 characters.";
  if (next !== confirm) return "The new passwords don't match.";
  if (next === current) return "The new password must differ from the current one.";
  return null;
}

export function passwordErrorMessage(status: number, retryAfterS?: number): string {
  if (status === 401) return "Current password is wrong";
  if (status === 409) return "Password was changed elsewhere; sign in again";
  if (status === 429) {
    const minutes = Math.max(1, Math.ceil((retryAfterS ?? 900) / 60));
    return `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (status === 400) return "The new password must be 12 to 128 characters and differ from the current one.";
  return "Password change is unavailable right now. Try again shortly.";
}

/** The agent's money limits from the active policies' rules; only rules that exist are listed. */
export function agentLimits(rules: Rule[]): { refunds: string | null; discounts: string | null } {
  const find = <K extends Rule["rule"]>(k: K) => rules.find((r): r is Extract<Rule, { rule: K }> => r.rule === k);
  const session = find("session_budget_le");
  const daily = find("daily_budget_le");
  const discount = find("discount_percent_le");
  const refunds = [session && `$${session.amount} per conversation`, daily && `$${daily.amount} per day`].filter(Boolean).join(" · ");
  return { refunds: refunds || null, discounts: discount ? `Up to ${discount.percent}%` : null };
}
