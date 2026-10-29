import { utcTime } from "./overview-view";

export const P0_PACKS = ["invented-policy", "price-manipulation", "refund-pressure", "prompt-injection", "honest"] as const;
export const PACKS = [...P0_PACKS, "learned"] as const;

/** One agent's certification snapshot (@keel/gauntlet Versions): keys the agent doesn't depend on are absent. */
export interface Versions {
  agent_id?: string;
  agent_model: string;
  agent_prompt: string;
  extractor_model: string;
  extractor_prompt_version: string;
  extractor_timeout_ms: number;
  policies: Record<string, number>;
  risk_threshold?: number;
  risk_half_life_min?: number;
  handoff_model?: string;
  handoff_prompt?: string;
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
  /** Per agent only; the combined certification (no agent_id) carries `agents` instead. */
  current_versions?: Versions;
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

/** A run's display name: its start time, with "Latest" on the newest run. */
export const runName = (run: Pick<Run, "id" | "created_at">, latestId: string | undefined): string =>
  `${run.id === latestId ? "Latest · " : ""}${utcTime(run.created_at)} UTC`;

export const isActive = (status: string) => status === "QUEUED" || status === "RUNNING";

/** "85%" for 0.85; an em dash when there is nothing to rate. */
export const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);

const OUTCOME: Record<string, { label: string; tone: string }> = {
  PASS: { label: "Pass", tone: "ok" },
  LEAK: { label: "Leak", tone: "bad" },
  FALSE_POSITIVE: { label: "False positive", tone: "warn" },
  ERROR: { label: "Error", tone: "" },
};
/** Wording and status-dot class for a scenario outcome. */
export const outcomeBadge = (o: string) => OUTCOME[o] ?? { label: o, tone: "" };

const CERT = {
  CERTIFIED: { label: "Certified", tone: "ok" },
  STALE: { label: "Stale", tone: "warn" },
  NOT_CERTIFIED: { label: "Not certified", tone: "" },
};
/** Wording and badge class for a certification status. */
export const certBadge = (s: Certification["status"]) => CERT[s] ?? CERT.NOT_CERTIFIED;

const PACK_LABELS: Record<string, string> = {
  honest: "Honest customers",
  "invented-policy": "Invented policy",
  "price-manipulation": "Price manipulation",
  "refund-pressure": "Refund pressure",
  "prompt-injection": "Prompt injection",
  learned: "Learned from live traffic",
};
export const packLabel = (p: string) => PACK_LABELS[p] ?? p;

export interface PackStats {
  pack: string;
  conversations: number;
  passed: number;
  leaks: number;
  /** Null for a pack with no honest scenarios: false positives only exist there. */
  falsePositives: number | null;
  errors: number;
  /** Over the conversations that didn't error, as the scorecard rates them. */
  passRate: number | null;
}

/** Per-pack counts from a run's results, sorted by pack label. */
export function packStats(results: RunResult[]): PackStats[] {
  const by = new Map<string, RunResult[]>();
  for (const r of results) by.set(r.pack, [...(by.get(r.pack) ?? []), r]);
  return [...by]
    .map(([pack, rows]) => {
      const count = (o: string) => rows.filter((r) => r.outcome === o).length;
      const errors = count("ERROR");
      const passed = count("PASS");
      return {
        pack,
        conversations: rows.length,
        passed,
        leaks: count("LEAK"),
        falsePositives: rows.some((r) => r.kind === "honest") ? count("FALSE_POSITIVE") : null,
        errors,
        passRate: rows.length === errors ? null : passed / (rows.length - errors),
      };
    })
    .sort((a, b) => packLabel(a.pack).localeCompare(packLabel(b.pack)));
}

/** The Run history's result column: what the run shows, from its own data and the current certification. */
export function runOutcome(run: Run, cert: Pick<Certification, "status" | "run_id">): { label: string; tone: string } {
  if (isActive(run.status)) return { label: run.status === "QUEUED" ? "Queued" : "Running", tone: "info" };
  if (run.status === "FAILED") return { label: "Failed", tone: "bad" };
  if (!run.scorecard) return { label: "No scorecard", tone: "" };
  if (!run.guarded) return { label: "Baseline", tone: "" };
  if (run.scorecard.leaks > 0) return { label: "Leak", tone: "bad" };
  if (run.id === cert.run_id && cert.status === "CERTIFIED") return { label: "Certifies", tone: "ok" };
  if (run.id === cert.run_id && cert.status === "STALE") return { label: "Certified, stale", tone: "warn" };
  return { label: "No leaks", tone: "ok" };
}

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
