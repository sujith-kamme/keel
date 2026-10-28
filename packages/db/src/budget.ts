import { fromCents, toCents } from "@keel/engine";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import { ledgerEntries } from "./schema";

const DAY_MS = 86_400_000;

// Refunds that moved money. PayPal may report a refund as PENDING before it
// settles; it still counts against budgets. A reviewer-approved held refund is
// executed on the `review` row (a discount's execution status is ISSUED).
const executedRefund = sql`(${ledgerEntries.payload}->>'tool' = 'offer_refund'
    or (${ledgerEntries.payload}->>'tool' = 'review' and ${ledgerEntries.payload}->>'action' = 'approve'))
  and ${ledgerEntries.payload}->'execution'->>'status' in ('COMPLETED', 'PENDING')`;
const amount = sql<string>`${ledgerEntries.payload}->'execution'->>'amount'`;

const sum = (rows: { amount: string }[]) => fromCents(rows.reduce((total, row) => total + toCents(row.amount), 0));

/**
 * Budget facts from the ledger: this session's refunds and all refunds in the last 24 hours.
 * The daily total leaves out CONTEXT (sandbox certification and test) runs, so
 * they can never use up the live merchant budget.
 */
export async function refundTotals(db: Db, sessionId: string, now: Date) {
  const [session, daily] = await Promise.all([
    db.select({ amount }).from(ledgerEntries).where(and(executedRefund, eq(ledgerEntries.sessionId, sessionId))),
    db
      .select({ amount })
      .from(ledgerEntries)
      .where(
        and(
          executedRefund,
          ne(ledgerEntries.mode, "CONTEXT"),
          gte(ledgerEntries.createdAt, new Date(now.getTime() - DAY_MS)),
        ),
      ),
  ]);
  return { session_refunded: sum(session), daily_refunded: sum(daily) };
}
