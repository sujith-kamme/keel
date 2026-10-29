import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { HANDOFF, connectAgentTools, runTurn } from "@keel/agent";
import { env } from "@/lib/env";
import { agentConfig, appendTurn, guardReply, KeelError, sessionDetail } from "@/lib/keel";
import { chatHistory } from "@/lib/history";
import { ChatBody } from "@/lib/store-input";
import { readChatCookie } from "../cookie";

export async function POST(request: Request) {
  const body = ChatBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const chat = await readChatCookie();
  if (!chat) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const { text } = body.data;
  try {
    const detail = await sessionDetail(chat.session_id);
    const history = chatHistory(detail);
    try {
      await appendTurn(chat.session_id, { role: "customer", text, decision_ids: [] });
    } catch (err) {
      if (err instanceof KeelError && err.status === 429) return NextResponse.json({ error: "turn_limit" }, { status: 429 });
      throw err;
    }
    const anthropic = new Anthropic({ apiKey: env().anthropicKey });
    const config = await agentConfig();
    const agent = await connectAgentTools(env().keelApiUrl, chat.token);
    try {
      const { reply, decision_ids } = await runTurn(
        { model: config.model, mode: config.prompt, role: "refund", createMessage: (p) => anthropic.messages.create(p), tools: agent.tools, callTool: agent.callTool },
        { context: { customer_email: chat.email, verified: chat.verified, orders: chat.orders }, history, customerText: text },
      );
      // Never send the unguarded draft: if the guard fails, hand off (DP-4).
      const guard = await guardReply({
        session_id: chat.session_id,
        draft_reply: reply,
        conversation: [...history.map(({ role, text }) => ({ role, text })), { role: "customer" as const, text }].slice(-50),
        tool_calls_this_turn: decision_ids,
      }).catch(() => null);
      const final = guard?.final_reply ?? HANDOFF;
      await appendTurn(chat.session_id, { role: "agent", text: final, decision_ids: guard ? [...decision_ids, guard.decision_id] : decision_ids });
      return NextResponse.json({ reply: final });
    } finally {
      await agent.close().catch(() => {});
    }
  } catch (err) {
    if (err instanceof KeelError && err.status === 404) return NextResponse.json({ error: "no_session" }, { status: 401 });
    console.error("store chat failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ reply: HANDOFF });
  }
}
