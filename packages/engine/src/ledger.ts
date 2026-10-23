import { createHash } from "node:crypto";
import type { Mode, ReasonCode, Verdict } from "@keel/core";
import { canonicalJson } from "./canonical";

export interface LedgerContent {
  decision_id: string;
  session_id: string | null;
  order_id: string | null;
  capture_id: string | null;
  dispute_id: string | null;
  mode: Mode;
  verdict: Verdict;
  reason_codes: ReasonCode[];
  payload: unknown;
}

export interface LedgerRecord extends LedgerContent {
  prev_hash: string | null;
  hash: string;
}

export type ChainCheck = { ok: true } | { ok: false; index: number; reason: "HASH_MISMATCH" | "BROKEN_LINK" };

export function hashEntry(content: LedgerContent, prevHash: string | null): string {
  return createHash("sha256").update(canonicalJson({ ...content, prev_hash: prevHash })).digest("hex");
}

export function chainEntry(content: LedgerContent, prevHash: string | null): LedgerRecord {
  return { ...content, prev_hash: prevHash, hash: hashEntry(content, prevHash) };
}

/** Verifies a full chain from its first entry (whose prev_hash is null). */
export function verifyChain(records: readonly LedgerRecord[]): ChainCheck {
  let prev: string | null = null;
  for (const [index, record] of records.entries()) {
    if (record.prev_hash !== prev) return { ok: false, index, reason: "BROKEN_LINK" };
    const { hash, prev_hash, ...content } = record;
    if (hashEntry(content, prev_hash) !== hash) return { ok: false, index, reason: "HASH_MISMATCH" };
    prev = hash;
  }
  return { ok: true };
}
