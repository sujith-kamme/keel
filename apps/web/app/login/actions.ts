"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { CONSOLE_COOKIE, CONSOLE_TTL_MS, clientIp, consoleSession, loginError, safeNext } from "@/lib/console-auth";
import { env } from "@/lib/env";
import { OperatorError, consoleLogin } from "@/lib/operator";

export async function login(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const { webSecret } = env();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  let account: Awaited<ReturnType<typeof consoleLogin>>;
  try {
    account = await consoleLogin(email, password, ip);
  } catch (e) {
    // Anything but an API answer (network, timeout) gets the generic message.
    return { error: e instanceof OperatorError ? loginError(e.status, e.retryAfterS) : loginError(0) };
  }
  (await cookies()).set(CONSOLE_COOKIE, consoleSession(webSecret, new Date(), account.session_version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CONSOLE_TTL_MS / 1000,
  });
  const next = formData.get("next");
  redirect(safeNext(typeof next === "string" ? next : null));
}

export async function logout() {
  (await cookies()).delete(CONSOLE_COOKIE);
  redirect("/login");
}
