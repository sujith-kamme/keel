import type { DecisionSummary, SessionRow, Turn } from "./keel";

export function attachDecisions(turns: Turn[], decisions: DecisionSummary[]) {
  const byId = new Map(decisions.map((d) => [d.decision_id, d]));
  const used = new Set<string>();
  const withDecisions = turns.map((t) => {
    const attached: DecisionSummary[] = [];
    for (const id of t.decision_ids) {
      const d = byId.get(id);
      if (d) {
        attached.push(d);
        used.add(id);
      }
    }
    return { ...t, decisions: attached };
  });
  return { turns: withDecisions, unlinked: decisions.filter((d) => !used.has(d.decision_id)) };
}

export type RiskLevel = "low" | "medium" | "high";

export function riskLevel(score: number, threshold: number): RiskLevel {
  if (score >= threshold) return "high";
  return score < 30 ? "low" : "medium";
}

/** Bar width in percent, capped at 100. */
export function riskWidth(score: number, threshold: number): number {
  if (threshold <= 0) return 100;
  return Math.max(0, Math.min(100, (score / threshold) * 100));
}

export function relativeTime(iso: string, now: Date): string {
  const secs = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}


const SIGNALS: Record<string, string> = {
  INJECTION: "Prompt injection",
  REPEATED_AFTER_BLOCK: "Asked again after a block",
  FOREIGN_ORDER: "Asked about another customer's order",
};
export const signalKind = (kind: string) => SIGNALS[kind] ?? kind;

/** The states the list filters by (GET /v1/sessions `state`), in tab order. */
export const SESSION_STATES = ["ACTIVE", "ESCALATED", "QUARANTINED"] as const;

const STATE_TONE: Record<string, string> = { ACTIVE: "ok", ESCALATED: "warn", QUARANTINED: "bad" };

/** Status dot class and wording for a session state. */
export function sessionState(state: string): { label: string; tone: string } {
  return { label: state.charAt(0) + state.slice(1).toLowerCase(), tone: STATE_TONE[state] ?? "" };
}

/** Case-insensitive match on customer email, session id or any order id. */
export function matchesSearch(row: Pick<SessionRow, "claimed_email" | "id" | "order_ids">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.claimed_email, row.id, ...row.order_ids].some((v) => v.toLowerCase().includes(q));
}

/**
 * The list URL. `pages` holds the cursor of every page after the first that led here, so Previous drops
 * the last one; the last is the current page's `before`.
 */
export function sessionsHref(state: string | null, pages: string[]): string {
  const q = new URLSearchParams();
  if (state) q.set("state", state);
  if (pages.length > 0) q.set("pages", pages.join(","));
  const s = q.toString();
  return s ? `/sessions?${s}` : "/sessions";
}
