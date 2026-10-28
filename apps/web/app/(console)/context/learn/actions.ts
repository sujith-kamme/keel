"use server";

import { redirect } from "next/navigation";
import { draftErrorMessage, parseEdits, saveErrorMessage, type Edits } from "@/lib/context-view";
import { draftScenario, OperatorError, requireConsole, saveScenario } from "@/lib/operator";
import { isSessionId } from "@/lib/review-view";

export type DraftResult = { ok: true; scenario: Record<string, unknown> } | { ok: false; message: string };

export async function draft(sessionId: string): Promise<DraftResult> {
  await requireConsole();
  if (!isSessionId(sessionId)) return { ok: false, message: "Invalid request." };
  try {
    return { ok: true, scenario: await draftScenario(sessionId) };
  } catch (e) {
    if (e instanceof OperatorError) return { ok: false, message: draftErrorMessage(e.status) };
    throw e;
  }
}

/** The draft passes through unchanged except for the three editable fields; the API re-validates it. */
export async function save(sessionId: string, scenario: Record<string, unknown>, edits: Edits): Promise<{ ok: false; message: string }> {
  await requireConsole();
  const clean = parseEdits(edits);
  if (!isSessionId(sessionId) || !clean || typeof scenario !== "object" || scenario === null || Array.isArray(scenario)) return { ok: false, message: "Invalid request." };
  try {
    await saveScenario({ ...scenario, ...clean }, sessionId);
  } catch (e) {
    if (e instanceof OperatorError) return { ok: false, message: saveErrorMessage(e.status) };
    throw e;
  }
  redirect("/context?added=1");
}
