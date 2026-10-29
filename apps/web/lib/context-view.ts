export const P0_PACKS = ["invented-policy", "price-manipulation", "refund-pressure", "prompt-injection", "honest"] as const;
export const PACKS = [...P0_PACKS, "learned"] as const;

export interface Versions {
  agent_model: string;
  agent_prompt: string;
  extractor_model: string;
  extractor_prompt_version: string;
  policies: Record<string, number>;
}

export interface Scorecard {
  runs: number;
  errors: number;
  pass_rate: number;
  leaks: number;
  leaks_by_type: Record<string, number>;
  false_positive_rate: number | null;
  trigger_rate: number | null;
  dollars_protected: string;
  median_guard_latency_ms: number | null;
  packs: string[];
}

export interface Run {
  id: string;
  status: string;
  guarded: boolean;
  packs: string[];
  repeats: number;
  versions: Versions;
  progress: { total: number; done: number };
  scorecard: Scorecard | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface RunResult {
  scenario_id: string;
  pack: string;
  kind: string;
  repeat: number;
  session_id: string | null;
  outcome: string;
  triggered: boolean;
  leaks: string[];
  error: string | null;
}

export interface Certification {
  status: "CERTIFIED" | "STALE" | "NOT_CERTIFIED";
  run_id: string | null;
  reasons: string[];
  current_versions: Versions;
}

export interface ScenarioEntry {
  id: string;
  pack: string;
  kind: string;
  description: string;
  source: "builtin" | "learned";
}

export interface StartInput {
  packs: string[];
  repeats: number;
  guarded: boolean;
}

const RUN_ID = /^run_[a-f0-9]{32}$/;
export const isRunId = (v: unknown): v is string => typeof v === "string" && RUN_ID.test(v);

/** Returns a clean copy of the input, or null when it isn't a valid run request. */
export function parseStart(v: unknown): StartInput | null {
  if (typeof v !== "object" || v === null) return null;
  const { packs, repeats, guarded } = v as Record<string, unknown>;
  if (!Array.isArray(packs) || packs.length < 1 || packs.length > PACKS.length) return null;
  if (!packs.every((p) => (PACKS as readonly string[]).includes(p as string)) || new Set(packs).size !== packs.length) return null;
  if (typeof repeats !== "number" || !Number.isInteger(repeats) || repeats < 1 || repeats > 5) return null;
  if (typeof guarded !== "boolean") return null;
  return { packs: packs as string[], repeats, guarded };
}

export const isActive = (status: string) => status === "QUEUED" || status === "RUNNING";

/** "85%" for 0.85; an em dash when there is nothing to rate. */
export const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);

const OUTCOME_STYLE: Record<string, string> = {
  PASS: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  LEAK: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  FALSE_POSITIVE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  ERROR: "bg-gray-200 text-gray-800 dark:bg-gray-700/60 dark:text-gray-200",
};
export const outcomeStyle = (o: string) => OUTCOME_STYLE[o] ?? OUTCOME_STYLE.ERROR;

const CERT_STYLE = {
  CERTIFIED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  STALE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  NOT_CERTIFIED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};
export const certStyle = (s: Certification["status"]) => CERT_STYLE[s] ?? CERT_STYLE.NOT_CERTIFIED;
export const certLabel = (s: Certification["status"]) => s.replace("_", " ");

export const progressPct = (p: { total: number; done: number }) => (p.total <= 0 ? 0 : Math.max(0, Math.min(100, (p.done / p.total) * 100)));

/** Newest DONE guarded and unguarded runs; null unless both exist. `runs` is newest first. */
export function pickBeforeAfter(runs: Run[]): { without: Run & { scorecard: Scorecard }; with: Run & { scorecard: Scorecard } } | null {
  const done = (guarded: boolean) => runs.find((r) => r.status === "DONE" && r.guarded === guarded && r.scorecard !== null);
  const w = done(true);
  const wo = done(false);
  if (!w?.scorecard || !wo?.scorecard) return null;
  return { without: wo as Run & { scorecard: Scorecard }, with: w as Run & { scorecard: Scorecard } };
}

export function startErrorMessage(status: number): string {
  if (status === 409) return "A run is already in progress";
  if (status === 503) return "Couldn't queue the run — try again";
  return `Request failed (${status}).`;
}

export function draftErrorMessage(status: number): string {
  if (status === 404) return "Session not found";
  if (status === 422) return "This session has nothing to learn from";
  if (status === 502) return "Couldn't draft a scenario — try again";
  return `Request failed (${status}).`;
}

export function saveErrorMessage(status: number): string {
  if (status === 409) return "A scenario with this id already exists";
  if (status === 400) return "The scenario isn't valid — check the fields and try again";
  if (status === 404) return "The source session no longer exists";
  if (status === 422) return "This session has nothing to learn from";
  return `Request failed (${status}).`;
}

export interface Edits {
  persona: string;
  description: string;
  openers: string[];
}

export const LIMITS = { persona: 600, description: 500, opener: 600 } as const;

/** Clean copy of the editable fields, or null when out of bounds. */
export function parseEdits(v: unknown): Edits | null {
  if (typeof v !== "object" || v === null) return null;
  const { persona, description, openers } = v as Record<string, unknown>;
  if (typeof persona !== "string" || persona.trim() === "" || persona.length > LIMITS.persona) return null;
  if (typeof description !== "string" || description.trim() === "" || description.length > LIMITS.description) return null;
  if (!Array.isArray(openers) || openers.length < 1 || openers.length > 2) return null;
  if (!openers.every((o) => typeof o === "string" && o.trim() !== "" && o.length <= LIMITS.opener)) return null;
  return { persona, description, openers: openers as string[] };
}

/** Whether a LIVE session is worth offering "Add to Gauntlet" for. The API still refuses ineligible ones. */
export function canLearn(state: string, verdicts: string[]): boolean {
  return state === "QUARANTINED" || state === "ESCALATED" || verdicts.some((v) => v === "BLOCK" || v === "HOLD");
}

const CERT = {
  CERTIFIED: { label: "Certified", tone: "ok" },
  STALE: { label: "Stale", tone: "warn" },
  NOT_CERTIFIED: { label: "Not certified", tone: "" },
};
/** Wording and badge class for a certification status. */
export const certBadge = (s: Certification["status"]) => CERT[s] ?? CERT.NOT_CERTIFIED;
