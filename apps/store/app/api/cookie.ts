import "server-only";
import { cookies } from "next/headers";
import { currentCustomer } from "@/lib/customer";
import { env } from "@/lib/env";
import { seal, unseal } from "@/lib/seal";

const NAME = "keel_chat";

export interface ChatCookie {
  session_id: string;
  token: string;
  agent_id: string; // the agent the token is for; changes once, at the handoff
  email: string;
  verified: boolean;
  expires_at: string; // session expiry, kept so verify can reseal with the same lifetime
  orders: { order_id: string; total: string; items: string[] }[];
}

export async function writeChatCookie(value: ChatCookie) {
  const expiresAt = new Date(value.expires_at);
  (await cookies()).set(NAME, seal(value, env().cookieSecret, "chat", expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export async function readChatCookie(): Promise<ChatCookie | null> {
  const sealed = (await cookies()).get(NAME)?.value;
  const chat = sealed ? unseal<ChatCookie>(sealed, env().cookieSecret, "chat", new Date()) : null;
  // A chat belongs to the shopper who started it: signing out, or in as someone else, ends it.
  return chat && chat.email === (await currentCustomer()) ? chat : null;
}
