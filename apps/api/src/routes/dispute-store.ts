import type { DisputeClassification } from "@keel/core";
import { type Db, activePolicy, and, appendLedger, asc, desc, disputes, eq, inArray, ledgerEntries, sessionTurns, sessions, sql, storeOrders } from "@keel/db";
import type { LedgerContent } from "@keel/engine";
import type { Dispute } from "@keel/paypal/disputes";
import type { DisputeAction, DisputeContext, DisputeOutcome, DisputeRow, DisputeStore, LedgerRow } from "@keel/worker/dispute";
import type { DisputeApiStore, DisputeDetail, DisputeListItem } from "./disputes";

type Row = typeof disputes.$inferSelect;

const toRow = (r: Row): DisputeRow => ({
  id: r.id,
  capture_id: r.captureId,
  classification: r.classification as DisputeClassification | null,
  action: r.action as DisputeAction | null,
  outcome: r.outcome as DisputeOutcome,
  decision_id: r.decisionId,
  evidence_type: r.evidenceType,
  evidence_notes: r.evidenceNotes,
  evidence_pdf: r.evidencePdf,
});

const listItem = (r: Row): DisputeListItem => ({
  id: r.id,
  reason: r.reason,
  amount: r.amount,
  currency: r.currency,
  status: r.status,
  stage: r.stage,
  classification: r.classification,
  reason_codes: r.reasonCodes,
  action: r.action,
  action_error: r.actionError,
  outcome: r.outcome,
  created_at: r.createdAt.toISOString(),
  updated_at: r.updatedAt.toISOString(),
});

const ledgerRow = (r: typeof ledgerEntries.$inferSelect): LedgerRow => ({
  seq: r.seq,
  decision_id: r.decisionId,
  session_id: r.sessionId,
  order_id: r.orderId,
  verdict: r.verdict,
  reason_codes: r.reasonCodes,
  payload: (r.payload ?? {}) as Record<string, unknown>,
  prev_hash: r.prevHash,
  hash: r.hash,
  created_at: r.createdAt.toISOString(),
});

// Keep what the console shows; buyer messages are capped (they're untrusted text).
function trimmed(d: Dispute): Dispute {
  return { ...d, messages: (d.messages ?? []).slice(0, 10).map((m) => ({ ...m, content: m.content.slice(0, 1000) })) };
}

export function createDisputeStore(db: Db): DisputeStore & DisputeApiStore {
  const byId = async (id: string) => (await db.select().from(disputes).where(eq(disputes.id, id)))[0] ?? null;

  return {
    upsert: async (d, outcome, now) => {
      const fields = {
        status: d.status,
        stage: d.dispute_life_cycle_stage ?? null,
        outcome,
        paypal: trimmed(d),
        updatedAt: now,
      };
      const [row] = await db
        .insert(disputes)
        .values({
          id: d.dispute_id,
          captureId: d.disputed_transactions[0]?.seller_transaction_id ?? null,
          reason: d.reason,
          amount: d.dispute_amount.value,
          currency: d.dispute_amount.currency_code,
          createdAt: now,
          ...fields,
        })
        .onConflictDoUpdate({ target: disputes.id, set: fields })
        .returning();
      return toRow(row as Row);
    },

    context: async (captureId): Promise<DisputeContext> => {
      const [order] = await db.select().from(storeOrders).where(eq(storeOrders.captureId, captureId));
      if (!order) {
        const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.captureId, captureId)).orderBy(asc(ledgerEntries.seq));
        return { order: null, rows: rows.map(ledgerRow), turns: [], policies: [] };
      }
      // Live sessions that were scoped to the order (CONTEXT runs are simulations).
      const linked = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.mode, "LIVE"), sql`${sessions.orderIds} @> ${JSON.stringify([order.orderId])}::jsonb`));
      const sessionIds = linked.map((s) => s.id);
      const match = [eq(ledgerEntries.captureId, captureId), eq(ledgerEntries.orderId, order.orderId)];
      if (sessionIds.length) match.push(inArray(ledgerEntries.sessionId, sessionIds));
      const rows = await db
        .select()
        .from(ledgerEntries)
        .where(and(sql`(${sql.join(match, sql` or `)})`, sql`${ledgerEntries.disputeId} is null`))
        .orderBy(asc(ledgerEntries.seq));
      const turns = sessionIds.length
        ? await db.select().from(sessionTurns).where(inArray(sessionTurns.sessionId, sessionIds)).orderBy(asc(sessionTurns.createdAt))
        : [];
      const policyIds = new Set(["refund-window"]);
      for (const r of rows) {
        const id = ((r.payload as { args?: { policy_id?: unknown } }).args ?? {}).policy_id;
        if (typeof id === "string") policyIds.add(id);
      }
      const policies: DisputeContext["policies"] = [];
      for (const id of policyIds) {
        const p = (await activePolicy(db, id)) as { policy_id: string; version: number; approved_text: string } | null;
        if (p) policies.push({ policy_id: p.policy_id, version: p.version, approved_text: p.approved_text });
      }
      return {
        order: {
          order_id: order.orderId,
          capture_id: order.captureId,
          total: order.total,
          currency: order.currency,
          delivered_at: order.deliveredAt?.toISOString() ?? null,
          items: order.items.map((i) => ({ title: i.title, price: i.price })),
        },
        rows: rows.map(ledgerRow),
        turns: turns.map((t) => ({ session_id: t.sessionId, role: t.role as "customer" | "agent", text: t.text, at: t.createdAt.toISOString() })),
        policies,
      };
    },

    classify: (id, c, entry, now) =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(disputes)
          .set({
            classification: c.classification,
            reasonCodes: c.reason_codes,
            injection: c.injection,
            decisionId: c.decision_id,
            orderId: c.order_id,
            evidenceType: c.evidence_type,
            evidenceNotes: c.evidence_notes,
            evidencePdf: c.evidence_pdf,
            evidenceSha256: c.evidence_sha256,
            updatedAt: now,
          })
          .where(and(eq(disputes.id, id), sql`${disputes.classification} is null`))
          .returning({ id: disputes.id });
        if (updated.length !== 1) return false;
        await appendLedger(tx, entry as LedgerContent);
        return true;
      }),

    setAction: async (id, from, to, error, now) => {
      const named = from.filter((a): a is DisputeAction => a !== null);
      const conditions = [];
      if (named.length) conditions.push(inArray(disputes.action, named));
      if (from.includes(null)) conditions.push(sql`${disputes.action} is null`);
      if (!conditions.length) return false;
      const updated = await db
        .update(disputes)
        .set({ action: to, actionError: error, updatedAt: now })
        .where(and(eq(disputes.id, id), sql`(${sql.join(conditions, sql` or `)})`))
        .returning({ id: disputes.id });
      return updated.length === 1;
    },

    openIds: async () => {
      const rows = await db
        .select({ id: disputes.id })
        .from(disputes)
        .where(and(eq(disputes.outcome, "OPEN"), sql`${disputes.updatedAt} > now() - interval '30 days'`))
        .orderBy(desc(disputes.updatedAt))
        .limit(50);
      return rows.map((r) => r.id);
    },

    row: async (id) => {
      const r = await byId(id);
      return r ? toRow(r) : null;
    },

    list: async (limit) => (await db.select().from(disputes).orderBy(desc(disputes.createdAt)).limit(limit)).map(listItem),

    detail: async (id): Promise<DisputeDetail | null> => {
      const r = await byId(id);
      if (!r) return null;
      const own = await db.select().from(ledgerEntries).where(eq(ledgerEntries.disputeId, id)).orderBy(asc(ledgerEntries.seq));
      const decision = own.find((x) => x.decisionId === r.decisionId);
      const matched = ((decision?.payload as { matched_rows?: string[] } | undefined)?.matched_rows ?? []).slice(0, 200);
      const evidence = matched.length
        ? await db.select().from(ledgerEntries).where(inArray(ledgerEntries.decisionId, matched)).orderBy(asc(ledgerEntries.seq))
        : [];
      const p = r.paypal as Dispute;
      const view = (x: typeof ledgerEntries.$inferSelect) => {
        const payload = (x.payload ?? {}) as Record<string, unknown>;
        return {
          decision_id: x.decisionId,
          session_id: x.sessionId,
          tool: String(payload.tool ?? ""),
          verdict: x.verdict,
          reason_codes: x.reasonCodes,
          args: (payload.args ?? null) as Record<string, unknown> | null,
          action: typeof payload.action === "string" ? payload.action : null,
          reviewer: typeof payload.reviewer === "string" ? payload.reviewer : null,
          hash: x.hash,
          created_at: x.createdAt.toISOString(),
        };
      };
      return {
        ...listItem(r),
        capture_id: r.captureId,
        order_id: r.orderId,
        injection: r.injection,
        decision_id: r.decisionId,
        evidence_type: r.evidenceType,
        evidence_notes: r.evidenceNotes,
        evidence_sha256: r.evidenceSha256,
        has_evidence: r.evidencePdf !== null,
        buyer_messages: (p.messages ?? []).filter((m) => m.posted_by === "BUYER").map((m) => m.content),
        offered: (p.links ?? []).map((l) => l.rel).filter((rel) => rel !== "self"),
        decisions: own.map(view),
        evidence: evidence.map(view),
      };
    },

    pdf: async (id) => (await db.select({ pdf: disputes.evidencePdf }).from(disputes).where(eq(disputes.id, id)))[0]?.pdf ?? null,
  };
}
