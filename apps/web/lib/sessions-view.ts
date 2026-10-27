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
