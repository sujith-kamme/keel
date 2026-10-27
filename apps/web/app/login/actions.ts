"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CONSOLE_COOKIE, CONSOLE_TTL_MS, checkLogin, consoleSession, safeNext } from "@/lib/console-auth";
import { env } from "@/lib/env";

export async function login(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const { consoleUser, consolePassword, webSecret } = env();
  const user = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!checkLogin(user, password, { user: consoleUser, password: consolePassword })) {
    return { error: "Wrong username or password" };
  }
  (await cookies()).set(CONSOLE_COOKIE, consoleSession(webSecret, new Date()), {
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
