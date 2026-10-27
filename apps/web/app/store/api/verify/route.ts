import { NextResponse } from "next/server";
import { KeelError, verifySession } from "@/lib/keel";
import { VerifyBody } from "@/lib/store-input";
import { readChatCookie, writeChatCookie } from "../cookie";

const ALLOWED = ["wrong", "expired", "locked", "invalid_request"];

export async function POST(request: Request) {
  const body = VerifyBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const chat = await readChatCookie();
  if (!chat) return NextResponse.json({ error: "no_session" }, { status: 401 });
  try {
    const verified = await verifySession(chat.session_id, body.data.code);
    await writeChatCookie({ ...chat, token: verified.capability_token, verified: true });
    return NextResponse.json({ verified: true });
  } catch (err) {
    if (err instanceof KeelError && err.status === 404) return NextResponse.json({ error: "no_session" }, { status: 401 });
    if (err instanceof KeelError && err.status === 400) {
      const code = ALLOWED.includes(err.error ?? "") ? err.error : "invalid_code";
      return NextResponse.json({ error: code }, { status: 400 });
    }
    console.error("store verify failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
