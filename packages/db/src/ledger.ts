import { chainEntry, type LedgerContent, type LedgerRecord } from "@keel/engine";
import type { Mode, ReasonCode, Verdict } from "@keel/core";
import { and, asc, desc, lt, ne, sql } from "drizzle-orm";
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

type LedgerRow = typeof ledgerEntries.$inferSelect;

const toRecord = (row: LedgerRow): LedgerRecord => ({
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
});

export async function readLedger(db: Db): Promise<LedgerRecord[]> {
  const rows = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.seq));
  return rows.map(toRecord);
}

export type LedgerPageRow = LedgerRecord & { seq: number; created_at: Date };

/** Newest first; `limit` is clamped to 1..2000. `live` leaves out simulated CONTEXT (Gauntlet) rows. */
export async function readLedgerPage(db: Db, opts: { beforeSeq?: number; limit: number; live?: boolean }): Promise<LedgerPageRow[]> {
  const limit = Math.min(2000, Math.max(1, Math.trunc(opts.limit)));
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        opts.beforeSeq === undefined ? undefined : lt(ledgerEntries.seq, opts.beforeSeq),
        opts.live ? ne(ledgerEntries.mode, "CONTEXT") : undefined,
      ),
    )
    .orderBy(desc(ledgerEntries.seq))
    .limit(limit);
  return rows.map((row) => ({ ...toRecord(row), seq: row.seq, created_at: row.createdAt }));
}

/**
 * The whole chain in seq order. `seq` sits beside the record, not in it:
 * verifyChain hashes every field but `hash` and `prev_hash`, and seq was never hashed.
 */
export async function readChain(db: Db): Promise<{ seq: number; record: LedgerRecord }[]> {
  const rows = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.seq));
  return rows.map((row) => ({ seq: row.seq, record: toRecord(row) }));
}
