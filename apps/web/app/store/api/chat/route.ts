import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { HANDOFF, runTurn } from "@/lib/agent";
import { env } from "@/lib/env";
import { appendTurn, KeelError, sessionDetail } from "@/lib/keel";
import { connectAgentTools } from "@/lib/mcp";
import { ChatBody } from "@/lib/store-input";
import { readChatCookie } from "../cookie";

export async function POST(request: Request) {
  const body = ChatBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const chat = await readChatCookie();
  if (!chat) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const { text } = body.data;
  try {
    const history = (await sessionDetail(chat.session_id)).turns.map(({ role, text }) => ({ role, text }));
    try {
      await appendTurn(chat.session_id, { role: "customer", text, decision_ids: [] });
    } catch (err) {
      if (err instanceof KeelError && err.status === 429) return NextResponse.json({ error: "turn_limit" }, { status: 429 });
      throw err;
    }
    const anthropic = new Anthropic({ apiKey: env().anthropicKey });
    const agent = await connectAgentTools(chat.token);
    try {
      const { reply, decision_ids } = await runTurn(
        { model: env().model, createMessage: (p) => anthropic.messages.create(p), tools: agent.tools, callTool: agent.callTool },
        { context: { customer_email: chat.email, verified: chat.verified, orders: chat.orders }, history, customerText: text },
      );
      await appendTurn(chat.session_id, { role: "agent", text: reply, decision_ids });
      return NextResponse.json({ reply });
    } finally {
      await agent.close().catch(() => {});
    }
  } catch (err) {
    console.error("store chat failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ reply: HANDOFF });
  }
}
