// Shape of GET /v1/overview and how the Overview page words it.
import type { Certification } from "./context-view";
import type { LedgerRow } from "./ledger-view";
import { reasonLabel } from "./reason-labels";

export interface Dollars {
  blocked_refunds: string;
  denied_holds: string;
  disputes_won: string;
  total: string;
}

export interface Violations {
  total: number;
  byReason: { code: string; count: number }[];
}

export interface DayCounts {
  day: string;
  ALLOW: number;
  REWRITE: number;
  BLOCK: number;
  HOLD: number;
}

export interface DisputeOutcomes {
  OPEN: number;
  WON: number;
  LOST: number;
  CONCEDED: number;
  amount_won: string;
  amount_conceded: string;
}

/** The certifying run's stats are present when certification names a run. */
export type OverviewCertification = Certification & { leaks?: number; scenarios?: number; finished_at?: string | null };

export interface Overview {
  certification: OverviewCertification | null;
  sessions: { active: number; quarantined: number };
  violations: { all_time: Violations; last_7_days: Violations };
  dollars_protected: { all_time: Dollars; last_7_days: Dollars };
  decisions_by_day: DayCounts[];
  disputes: DisputeOutcomes;
  /** The newest live ledger rows, newest first. */
  recent_activity: LedgerRow[];
}

/** "$1,234.50" from "1234.5", by string so no float rounding; an em dash for anything else. */
export function usd(value: string): string {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) return "—";
  return `$${m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(m[2] ?? "").padEnd(2, "0")}`;
}

const UTC = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** "Oct 28, 21:37" in UTC; an em dash for anything unparseable. */
export function utcTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : UTC.format(d);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type CertStrip = { tone: "ok" | "warn" | "neu"; title: string; runId: string | null; detail: string };

/** The Overview's certification strip: the state, the run it rests on and why. */
export function certStrip(cert: OverviewCertification | null): CertStrip {
  if (!cert) return { tone: "neu", title: "Certification unavailable", runId: null, detail: "Couldn't load certification." };
  const stats = [
    cert.leaks !== undefined && cert.scenarios !== undefined ? `${plural(cert.leaks, "leak")} in ${plural(cert.scenarios, "scenario")}` : null,
    cert.finished_at ? `${utcTime(cert.finished_at)} UTC` : null,
  ].filter((x) => x !== null);
  const tail = stats.length > 0 ? ` · ${stats.join(" · ")}` : "";
  const reasons = cert.reasons.join("; ");
  if (cert.status === "CERTIFIED") return { tone: "ok", title: "Certified", runId: cert.run_id, detail: `passed on the versions in production${tail}` };
  if (cert.status === "STALE") return { tone: "warn", title: "Stale", runId: cert.run_id, detail: `passed, but production has changed since: ${reasons}${tail}` };
  if (!cert.run_id) return { tone: "neu", title: "Not certified", runId: null, detail: reasons ? reasons.charAt(0).toUpperCase() + reasons.slice(1) : "" };
  return { tone: "neu", title: "Not certified", runId: cert.run_id, detail: `did not pass: ${reasons}${tail}` };
}

/** Status dot class and wording for a verdict, as the console's decision badges show it. */
const DECISION: Record<string, { label: string; tone: string }> = {
  ALLOW: { label: "Allowed", tone: "ok" },
  REWRITE: { label: "Rewritten", tone: "info" },
  HOLD: { label: "Held", tone: "warn" },
  BLOCK: { label: "Blocked", tone: "bad" },
};
export const decision = (verdict: string) => DECISION[verdict] ?? { label: verdict, tone: "" };

const TOOLS: Record<string, string> = {
  get_order: "Order lookup",
  offer_refund: "Refund",
  offer_discount: "Discount",
  state_policy: "Policy statement",
  escalate_to_human: "Escalation",
  guard: "Reply check",
  risk: "Risk score",
  review: "Review decision",
  release: "Session released",
  kill_switch: "Kill switch",
  dispute: "Dispute classified",
  dispute_action: "Dispute action",
  settings_update: "Settings changed",
  policy_approve: "Policy version approved",
  policy_discard: "Policy draft discarded",
  console_email_change: "Console email changed",
  console_password_change: "Console password changed",
  console_sessions_revoke: "Console sessions revoked",
};

export interface Activity {
  seq: number;
  time: string;
  event: string;
  reference: string | null;
  amount: string | null;
  decision: { label: string; tone: string };
}

/** A ledger row as one line of recent activity: what happened, to which order, dispute or session. */
export function activity(row: LedgerRow): Activity {
  const base = (row.tool && TOOLS[row.tool]) ?? row.tool ?? "Ledger entry";
  const reasons = row.reason_codes.filter((c) => c !== "OK").map(reasonLabel);
  return {
    seq: row.seq,
    time: utcTime(row.created_at),
    event: reasons.length > 0 ? `${base} · ${reasons.join(", ")}` : base,
    reference: row.order_id ?? row.dispute_id ?? row.session_id,
    amount: row.amount === null ? null : usd(row.amount),
    decision: decision(row.verdict),
  };
}

/** The Decisions chart's stacks, bottom to top, in the v3 chart tokens its legend also uses. */
export const VERDICT_SERIES = [
  { key: "ALLOW", name: "Allowed", color: "--chart-2" },
  { key: "REWRITE", name: "Rewritten", color: "--chart-1" },
  { key: "HOLD", name: "Held", color: "--chart-3" },
  { key: "BLOCK", name: "Blocked", color: "--chart-4" },
] as const;

/** "Oct 15" from "2026-10-15". */
export const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
