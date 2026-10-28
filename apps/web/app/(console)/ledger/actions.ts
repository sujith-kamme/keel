"use server";

import { isBeforeSeq, type ChainResult, type LedgerPage } from "@/lib/ledger-view";
import { OperatorError, ledgerPage, requireConsole, verifyLedger } from "@/lib/operator";
import { errorMessage } from "@/lib/review-view";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function toData<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof OperatorError) return { ok: false, message: errorMessage(e.status, e.error, e.reasonCode) };
    throw e;
  }
}

export async function verify(): Promise<Result<ChainResult>> {
  await requireConsole();
  return toData(verifyLedger);
}

export async function loadOlder(beforeSeq: number): Promise<Result<LedgerPage>> {
  await requireConsole();
  if (!isBeforeSeq(beforeSeq)) return { ok: false, message: "Invalid request." };
  return toData(() => ledgerPage(beforeSeq));
}
