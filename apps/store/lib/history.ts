import type { DecisionSummary, SessionDetail } from "./keel";

/** The session's turns, each with the decisions it links to, as the agent's history. */
export function chatHistory({ turns, decisions }: SessionDetail) {
  const byId = new Map(decisions.map((d) => [d.decision_id, d]));
  return turns.map(({ role, text, decision_ids }) => ({
    role,
    text,
    decisions: decision_ids.map((id) => byId.get(id)).filter((d): d is DecisionSummary => d !== undefined),
  }));
}
