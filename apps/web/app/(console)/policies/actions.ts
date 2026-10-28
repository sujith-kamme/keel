"use server";

import { type ActionResult, approvePolicy, draftPolicy, requireConsole, toResult } from "@/lib/operator";
import { type Rule, documentProblem, isPolicyId, policyErrorMessage } from "@/lib/policies-view";

const invalid: ActionResult = { ok: false, message: "Invalid request." };

export async function draft(id: string, document: string): Promise<ActionResult> {
  await requireConsole();
  if (!isPolicyId(id) || typeof document !== "string") return invalid;
  const problem = documentProblem(document);
  if (problem) return { ok: false, message: problem };
  // Never log the document.
  return toResult(() => draftPolicy(id, document), policyErrorMessage);
}

/** The API checks the text and every rule against the engine's Policy schema. */
export async function approve(id: string, version: number, approvedText: string, rules: Rule[]): Promise<ActionResult> {
  const { user } = await requireConsole();
  if (!isPolicyId(id) || !Number.isSafeInteger(version) || version < 1 || typeof approvedText !== "string" || !Array.isArray(rules)) return invalid;
  return toResult(() => approvePolicy(id, version, { reviewer: user, approved_text: approvedText, rules }), policyErrorMessage);
}
