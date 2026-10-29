import type { HistoryDecision, TurnInput, TurnOutput } from "./agent";
import { type AgentId, isAgentId } from "./agents";

type Role = "customer" | "agent";
type Decision = HistoryDecision & { decision_id: string };
type Detail = { turns: { role: Role; text: string; decision_ids: string[] }[]; decisions: Decision[] };

export interface ChatDeps {
  keel: {
    detail: (sessionId: string) => Promise<Detail>;
    appendTurn: (sessionId: string, turn: { role: Role; text: string; decision_ids: string[]; agent_id?: string }) => Promise<void>;
    guard: (body: { session_id: string; draft_reply: string; conversation: { role: Role; text: string }[]; tool_calls_this_turn: string[] }) => Promise<{ final_reply: string; decision_id: string }>;
    token: (sessionId: string) => Promise<{ agent_id: string; capability_token: string }>;
  };
  /** One agent, connected to Keel's MCP endpoint with this token. */
  agent: (agentId: AgentId, token: string) => Promise<{ turn: (input: TurnInput) => Promise<TurnOutput>; close: () => Promise<void> }>;
  /** False in Gauntlet runs that certify the policy agent: the conversation stops at the handoff. */
  followHandoff: boolean;
  /** Sent instead of a draft the guard could not check. */
  fallback: string;
}

export interface ChatInput {
  sessionId: string;
  token: string;
  agentId: AgentId;
  context: TurnInput["context"];
  customerText: string;
}

export interface ChatOutput {
  replies: { agent_id: AgentId; text: string }[];
  agentId: AgentId;
  token: string;
}

/** The session's turns, each with the decisions it links to, as the agent's history. */
export function chatHistory({ turns, decisions }: Detail): TurnInput["history"] {
  const byId = new Map(decisions.map((d) => [d.decision_id, d]));
  return turns.map(({ role, text, decision_ids }) => ({
    role,
    text,
    decisions: decision_ids.flatMap((id) => {
      const d = byId.get(id);
      return d ? [{ tool: d.tool, order_id: d.order_id, verdict: d.verdict, reason_codes: d.reason_codes }] : [];
    }),
  }));
}

/**
 * One customer message: append it, run the current agent, guard and append its reply.
 * If Keel allowed that agent's handoff, run the refund agent on the same message with its own token.
 */
export async function chatTurn(deps: ChatDeps, input: ChatInput): Promise<ChatOutput> {
  const { sessionId, context, customerText } = input;
  const first = await deps.keel.detail(sessionId);
  await deps.keel.appendTurn(sessionId, { role: "customer", text: customerText, decision_ids: [] });

  const replies: ChatOutput["replies"] = [];
  let agentId = input.agentId;
  let token = input.token;
  let history = chatHistory(first);

  for (let hop = 0; hop < 2; hop++) {
    const agent = await deps.agent(agentId, token);
    let reply: string;
    let decisionIds: string[];
    try {
      const out = await agent.turn({ context, history, customerText });
      decisionIds = out.decision_ids;
      // Never send the unguarded draft: if the guard fails, send the fallback.
      const guard = await deps.keel
        .guard({
          session_id: sessionId,
          draft_reply: out.reply,
          conversation: [...history.map(({ role, text }) => ({ role, text })), { role: "customer" as const, text: customerText }].slice(-50),
          tool_calls_this_turn: out.decision_ids,
        })
        .catch(() => null);
      reply = guard?.final_reply ?? deps.fallback;
      await deps.keel.appendTurn(sessionId, { role: "agent", text: reply, decision_ids: guard ? [...out.decision_ids, guard.decision_id] : out.decision_ids, agent_id: agentId });
    } finally {
      await agent.close().catch(() => {});
    }
    replies.push({ agent_id: agentId, text: reply });

    // The handoff is what Keel decided for this turn's tool call, never what the reply claims.
    const after = await deps.keel.detail(sessionId);
    const handedOff = after.decisions.some((d) => decisionIds.includes(d.decision_id) && d.tool === "handoff_to_refund" && d.verdict === "ALLOW");
    if (!handedOff) break;
    if (!deps.followHandoff) {
      agentId = "agt_refund";
      break;
    }
    const minted = await deps.keel.token(sessionId);
    if (!isAgentId(minted.agent_id) || minted.agent_id === agentId) break;
    agentId = minted.agent_id;
    token = minted.capability_token;
    // `after` ends with [this customer message, the handoff line]. runTurn appends
    // customerText itself, so drop the stored copy to avoid sending it twice.
    const all = chatHistory(after);
    history = [...all.slice(0, -2), all.at(-1)!];
  }
  return { replies, agentId, token };
}
