"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { CONSOLE_COOKIE, clientIp, consoleCookieOptions, consoleSession } from "@/lib/console-auth";
import { env } from "@/lib/env";
import {
  type ActionResult,
  OperatorError,
  changeConsoleEmail,
  changeConsolePassword,
  requireConsole,
  revokeConsoleSessions,
  saveSettings,
  testZapierHook,
  toResult,
} from "@/lib/operator";
import {
  ConsoleEmail,
  emailErrorMessage,
  isSection,
  passwordErrorMessage,
  passwordProblem,
  sectionProblem,
  sectionValues,
  settingsErrorMessage,
  zapierTestError,
  zapierTestMessage,
} from "@/lib/settings-view";

const invalid: ActionResult = { ok: false, message: "Invalid request." };

/** Saves one section's full set of values; the API ledgers each change under the signed-in email. */
export async function saveSection(section: string, values: unknown): Promise<ActionResult> {
  const { user } = await requireConsole();
  if (!isSection(section)) return invalid;
  const parsed = sectionValues(section, values);
  if (!parsed) return { ok: false, message: sectionProblem(section) };
  return toResult(() => saveSettings(section, parsed, user), settingsErrorMessage);
}

export async function testZapier(): Promise<{ ok: boolean; message: string }> {
  await requireConsole();
  try {
    const r = await testZapierHook();
    return { ok: r.ok, message: zapierTestMessage(r) };
  } catch (e) {
    if (e instanceof OperatorError) return { ok: false, message: zapierTestError(e.status) };
    throw e;
  }
}

export async function changeEmail(email: string): Promise<ActionResult> {
  const { user } = await requireConsole();
  const parsed = ConsoleEmail.safeParse(email);
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };
  return toResult(() => changeConsoleEmail(parsed.data, user), emailErrorMessage);
}

/** Every other session ends; this browser's cookie is re-issued with the new session version so it stays signed in. */
export async function changePassword(current: string, next: string, confirm: string): Promise<ActionResult> {
  const { user } = await requireConsole();
  const problem = passwordProblem(current, next, confirm);
  if (problem) return { ok: false, message: problem };
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  let version: number;
  try {
    version = (await changeConsolePassword(current, next, user, ip)).session_version;
  } catch (e) {
    if (e instanceof OperatorError) return { ok: false, message: passwordErrorMessage(e.status, e.retryAfterS) };
    throw e;
  }
  (await cookies()).set(CONSOLE_COOKIE, consoleSession(env().webSecret, new Date(), version), consoleCookieOptions());
  return { ok: true };
}

/** Ends every console session, this one included. */
export async function signOutEverywhere(): Promise<ActionResult> {
  const { user } = await requireConsole();
  const r = await toResult(() => revokeConsoleSessions(user), (status) => `Request failed (${status}).`);
  if (!r.ok) return r;
  (await cookies()).delete(CONSOLE_COOKIE);
  redirect("/login");
}
