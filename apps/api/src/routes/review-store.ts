import { type Db, and, appendLedger, desc, eq, inArray, ledgerEntries, sessions, sql } from "@keel/db";
import { MONEY_TOOLS as MONEY_TOOL_NAMES } from "@keel/risk";
import type { HeldEntry, ReviewStore } from "./review";

const MONEY_TOOLS = sql`(${sql.join(MONEY_TOOL_NAMES.map((t) => sql`${t}`), sql`, `)})`;

/** A review row with ref = `ref` and resolved = true exists. */
const resolved = (ref: unknown) =>
  sql`exists (select 1 from ledger_entries r where r.payload->>'tool' = 'review' and r.payload->>'ref' = ${ref} and r.payload->>'resolved' = 'true')`;

const heldColumns = {
  decisionId: ledgerEntries.decisionId,
  sessionId: ledgerEntries.sessionId,
  orderId: ledgerEntries.orderId,
  captureId: ledgerEntries.captureId,
  verdict: ledgerEntries.verdict,
  reasonCodes: ledgerEntries.reasonCodes,
  tool: sql<string>`${ledgerEntries.payload}->>'tool'`,
  args: sql<Record<string, unknown> | null>`${ledgerEntries.payload}->'args'`,
  createdAt: ledgerEntries.createdAt,
};

interface HeldRow {
  decisionId: string;
  sessionId: string | null;
  orderId: string | null;
  captureId: string | null;
  verdict: string;
  reasonCodes: string[];
  tool: string;
  args: Record<string, unknown> | null;
  createdAt: Date;
}

const toEntry = (r: HeldRow): HeldEntry => ({
  decision_id: r.decisionId,
  session_id: r.sessionId,
  order_id: r.orderId,
  capture_id: r.captureId,
  verdict: r.verdict,
  reason_codes: r.reasonCodes,
  tool: r.tool,
  args: r.args ?? {},
  created_at: r.createdAt.toISOString(),
});

export function createReviewStore(db: Db): ReviewStore {
  return {
    pendingHeld: async (limit) => {
      const rows = await db
        .select({ ...heldColumns, state: sessions.state })
        .from(ledgerEntries)
        .innerJoin(sessions, eq(sessions.id, ledgerEntries.sessionId))
        .where(and(eq(ledgerEntries.verdict, "HOLD"), sql`${ledgerEntries.payload}->>'tool' in ${MONEY_TOOLS}`, sql`not ${resolved(ledgerEntries.decisionId)}`))
        .orderBy(desc(ledgerEntries.seq))
        .limit(limit);
      return rows.map((r) => ({ ...toEntry(r), session_id: r.sessionId ?? "", session_state: r.state }));
    },
    flaggedSessions: async (limit) => {
      const rows = await db
        .select({
          id: sessions.id,
          state: sessions.state,
          createdAt: sessions.createdAt,
          reasonCodes: sql<string[] | null>`(select l.reason_codes from ledger_entries l
            where l.session_id = ${sessions.id} and l.payload->>'tool' = 'risk' order by l.seq desc limit 1)`,
        })
        .from(sessions)
        .where(
          and(
            inArray(sessions.state, ["QUARANTINED", "ESCALATED"]),
            sql`not exists (select 1 from ledger_entries h where h.session_id = ${sessions.id} and h.verdict = 'HOLD'
              and h.payload->>'tool' in ${MONEY_TOOLS} and not ${resolved(sql.raw("h.decision_id"))})`,
          ),
        )
        .orderBy(desc(sessions.createdAt))
        .limit(limit);
      return rows.map((r) => ({ session_id: r.id, session_state: r.state, reason_codes: r.reasonCodes ?? [], created_at: r.createdAt.toISOString() }));
    },
    entry: async (decisionId) => {
      const [row] = await db.select(heldColumns).from(ledgerEntries).where(eq(ledgerEntries.decisionId, decisionId));
      return row ? toEntry(row) : null;
    },
    isResolved: async (decisionId) => {
      const { rows } = await db.execute<{ resolved: boolean }>(sql`select ${resolved(decisionId)} as resolved`);
      return rows[0]?.resolved === true;
    },
    paymentUnconfirmed: async (decisionId) => {
      const { rows } = await db.execute<{ unconfirmed: boolean }>(sql`select exists (
        select 1 from ledger_entries f
        where f.payload->'execution'->>'status' = 'FAILED'
          and (f.decision_id = ${decisionId}
            or (f.payload->>'tool' = 'review' and f.payload->>'action' = 'approve' and f.payload->>'ref' = ${decisionId}))
      ) as unconfirmed`);
      return rows[0]?.unconfirmed === true;
    },
    session: async (id) => {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      return row ? { id: row.id, agent_id: row.agentId, verified_payer: row.verifiedPayer, order_ids: row.orderIds } : null;
    },
    release: (sessionId, content) =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(sessions)
          .set({ state: "ACTIVE" })
          .where(and(eq(sessions.id, sessionId), inArray(sessions.state, ["QUARANTINED", "ESCALATED"])))
          .returning({ id: sessions.id });
        if (updated.length !== 1) {
          const [exists] = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId));
          return exists ? "not_flagged" : "not_found";
        }
        await appendLedger(tx, content);
        return "released";
      }),
  };
}
