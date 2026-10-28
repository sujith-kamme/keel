"use server";

import { approveHeld, denyHeld, releaseSession, requireConsole, toResult, type ActionResult } from "@/lib/operator";
import { isDecisionId, isSessionId } from "@/lib/review-view";

const invalid: ActionResult = { ok: false, message: "Invalid request." };

export async function approve(decisionId: string): Promise<ActionResult> {
  const { user } = await requireConsole();
  if (!isDecisionId(decisionId)) return invalid;
  return toResult(() => approveHeld(decisionId, user));
}

export async function deny(decisionId: string): Promise<ActionResult> {
  const { user } = await requireConsole();
  if (!isDecisionId(decisionId)) return invalid;
  return toResult(() => denyHeld(decisionId, user));
}

export async function release(sessionId: string): Promise<ActionResult> {
  const { user } = await requireConsole();
  if (!isSessionId(sessionId)) return invalid;
  return toResult(() => releaseSession(sessionId, user));
}
