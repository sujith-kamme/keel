import type { DecisionSummary, Turn } from "./keel";

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

export const signalLabel = (s: { kind: string; weight: number; at: string }, now: Date) =>
  `${s.kind} +${s.weight} · ${relativeTime(s.at, now)}`;
