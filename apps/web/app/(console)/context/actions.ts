"use server";

import { parseStart, startErrorMessage, type StartInput } from "@/lib/context-view";
import { OperatorError, requireConsole, startGauntletRun } from "@/lib/operator";

export type StartResult = { ok: true; runId: string } | { ok: false; message: string };

export async function startRun(input: StartInput): Promise<StartResult> {
  await requireConsole();
  const clean = parseStart(input);
  if (!clean) return { ok: false, message: "Invalid request." };
  try {
    return { ok: true, runId: (await startGauntletRun(clean)).run_id };
  } catch (e) {
    if (e instanceof OperatorError) return { ok: false, message: startErrorMessage(e.status) };
    throw e;
  }
}
