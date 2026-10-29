import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { seal, unseal } from "@/lib/seal";

const NAME = "keel_chat";

export interface ChatCookie {
  session_id: string;
  token: string;
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
  return sealed ? unseal<ChatCookie>(sealed, env().cookieSecret, "chat", new Date()) : null;
}
