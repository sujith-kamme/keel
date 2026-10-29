import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { AGENTS, HANDOFF, chatTurn, connectAgentTools, isAgentId, runTurn } from "@keel/agent";
import { env } from "@/lib/env";
import { agentConfig, appendTurn, guardReply, KeelError, mintToken, sessionDetail } from "@/lib/keel";
import { ChatBody } from "@/lib/store-input";
import { readChatCookie, writeChatCookie } from "../cookie";

export async function POST(request: Request) {
  const body = ChatBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const chat = await readChatCookie();
  if (!chat || !isAgentId(chat.agent_id)) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const agentId = chat.agent_id;
  try {
    const anthropic = new Anthropic({ apiKey: env().anthropicKey });
    const config = await agentConfig();
    const out = await chatTurn(
      {
        keel: {
          detail: sessionDetail,
          appendTurn: async (id, turn) => void (await appendTurn(id, turn)),
          guard: guardReply,
          token: mintToken,
        },
        agent: async (id, token) => {
          const tools = await connectAgentTools(env().keelApiUrl, token);
          const deps = { model: config[id].model, mode: config[id].prompt, role: AGENTS[id].role, createMessage: (p: Anthropic.MessageCreateParamsNonStreaming) => anthropic.messages.create(p), tools: tools.tools, callTool: tools.callTool };
          return { turn: (input) => runTurn(deps, input), close: tools.close };
        },
        followHandoff: true,
        fallback: HANDOFF,
      },
      { sessionId: chat.session_id, token: chat.token, agentId, context: { customer_email: chat.email, verified: chat.verified, orders: chat.orders }, customerText: body.data.text },
    );
    if (out.agentId !== agentId) await writeChatCookie({ ...chat, agent_id: out.agentId, token: out.token });
    return NextResponse.json({ replies: out.replies });
  } catch (err) {
    if (err instanceof KeelError && err.status === 404) return NextResponse.json({ error: "no_session" }, { status: 401 });
    if (err instanceof KeelError && err.status === 429) return NextResponse.json({ error: "turn_limit" }, { status: 429 });
    console.error("store chat failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ replies: [{ agent_id: agentId, text: HANDOFF }] });
  }
}
