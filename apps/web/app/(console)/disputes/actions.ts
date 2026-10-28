"use server";

import { type ActionResult, disputeAction, lookupDispute, requireConsole, sandboxDispute, syncDisputes, toResult } from "@/lib/operator";
import { disputeErrorMessage, isDisputeId } from "@/lib/disputes-view";

const invalid: ActionResult = { ok: false, message: "Invalid request." };

export async function checkPayPal(): Promise<ActionResult> {
  await requireConsole();
  return toResult(() => syncDisputes(), disputeErrorMessage);
}

export async function lookup(id: string): Promise<ActionResult> {
  await requireConsole();
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (!isDisputeId(trimmed)) return { ok: false, message: "Enter a PayPal case ID like PP-R-ABC-12345678." };
  return toResult(() => lookupDispute(trimmed), disputeErrorMessage);
}

export async function decide(id: string, kind: "evidence" | "accept"): Promise<ActionResult> {
  const { user } = await requireConsole();
  if (!isDisputeId(id) || (kind !== "evidence" && kind !== "accept")) return invalid;
  return toResult(() => disputeAction(id, kind, user), disputeErrorMessage);
}

export async function sandbox(id: string, step: "escalate" | "seller" | "buyer"): Promise<ActionResult> {
  await requireConsole();
  if (!isDisputeId(id) || !["escalate", "seller", "buyer"].includes(step)) return invalid;
  return toResult(
    () => (step === "escalate" ? sandboxDispute(id, "escalate") : sandboxDispute(id, "adjudicate", step === "seller" ? "SELLER_FAVOR" : "BUYER_FAVOR")),
    disputeErrorMessage,
  );
}
