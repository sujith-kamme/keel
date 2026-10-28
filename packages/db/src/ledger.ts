import { chainEntry, type LedgerContent, type LedgerRecord } from "@keel/engine";
import type { Mode, ReasonCode, Verdict } from "@keel/core";
import { asc, desc, sql } from "drizzle-orm";
import type { Db } from "./client";
import { ledgerEntries } from "./schema";

// Arbitrary constant key: every append takes this transaction-scoped advisory
// lock, so two writers can never chain onto the same previous hash.
const LEDGER_LOCK_KEY = 4_242_001;

// Accepts a transaction too: a nested drizzle transaction becomes a savepoint.
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function appendLedger(db: DbOrTx, content: LedgerContent): Promise<LedgerRecord> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);
    const [last] = await tx
      .select({ hash: ledgerEntries.hash })
      .from(ledgerEntries)
      .orderBy(desc(ledgerEntries.seq))
      .limit(1);
    const record = chainEntry(content, last?.hash ?? null);
    await tx.insert(ledgerEntries).values({
      decisionId: record.decision_id,
      sessionId: record.session_id,
      orderId: record.order_id,
      captureId: record.capture_id,
      disputeId: record.dispute_id,
      mode: record.mode,
      verdict: record.verdict,
      reasonCodes: record.reason_codes,
      payload: record.payload,
      prevHash: record.prev_hash,
      hash: record.hash,
    });
    return record;
  });
}

export async function readLedger(db: Db): Promise<LedgerRecord[]> {
  const rows = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.seq));
  return rows.map((row) => ({
    decision_id: row.decisionId,
    session_id: row.sessionId,
    order_id: row.orderId,
    capture_id: row.captureId,
    dispute_id: row.disputeId,
    mode: row.mode as Mode,
    verdict: row.verdict as Verdict,
    reason_codes: row.reasonCodes as ReasonCode[],
    payload: row.payload,
    prev_hash: row.prevHash,
    hash: row.hash,
  }));
}
