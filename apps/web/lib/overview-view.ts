// Shape of GET /v1/overview and how the Overview page words it.
import { type Certification, certLabel, certStyle } from "./context-view";
import type { LedgerRow } from "./ledger-view";

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

export function certSummary(cert: Pick<Certification, "status" | "run_id" | "reasons"> | null): { label: string; style: string; reason: string } {
  if (!cert) return { label: "UNKNOWN", style: "bg-gray-200 text-gray-800 dark:bg-gray-700/60 dark:text-gray-200", reason: "Couldn't load certification." };
  return {
    label: certLabel(cert.status),
    style: certStyle(cert.status),
    reason: cert.reasons.length > 0 ? cert.reasons.join("; ") : "The latest guarded Gauntlet run passed on the versions running now.",
  };
}
