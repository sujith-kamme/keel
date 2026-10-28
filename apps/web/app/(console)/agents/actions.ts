"use server";

import { requireConsole, setFrozen, toResult, type ActionResult } from "@/lib/operator";
import { isAgentId } from "@/lib/review-view";

export async function setAgentFrozen(agentId: string, frozen: boolean): Promise<ActionResult> {
  const { user } = await requireConsole();
  if (!isAgentId(agentId) || typeof frozen !== "boolean") return { ok: false, message: "Invalid request." };
  return toResult(() => setFrozen(agentId, frozen, user));
}
