import { type LedgerRecord, hashEntry, verifyChain } from "@keel/engine";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { operatorAuth } from "./operator-auth";

export type LedgerPageRow = LedgerRecord & { seq: number; created_at: Date };

export interface LedgerOptions {
  operatorKey: string;
  merchantKey: string;
  /** Newest first, rows with seq < beforeSeq when given. */
  page: (opts: { beforeSeq?: number; limit: number }) => Promise<LedgerPageRow[]>;
  /** The whole chain in seq order. */
  chain: () => Promise<{ seq: number; record: LedgerRecord }[]>;
  count: () => Promise<number>;
  /** One entry with the entries either side of it in the chain; null when the seq doesn't exist. */
  entry: (seq: number) => Promise<{ row: LedgerPageRow; prev: { seq: number; hash: string } | null; next: { seq: number; hash: string } | null } | null>;
}

const PageQuery = z.strictObject({
  before_seq: z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).optional(),
  limit: z.string().regex(/^\d{1,4}$/).transform(Number).pipe(z.number().int().min(1).max(2000)).default(500),
});

const SEQ = /^[1-9]\d{0,15}$/;

const EXPORT_MAX = 10_000;

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** One ledger row for the console grid: tool and amount pulled out of the payload. */
export function ledgerView(row: LedgerPageRow) {
  const p = (row.payload ?? {}) as { tool?: unknown; args?: { amount?: unknown }; amount?: { value?: unknown } };
  return {
    seq: row.seq,
    decision_id: row.decision_id,
    created_at: row.created_at.toISOString(),
    session_id: row.session_id,
    order_id: row.order_id,
    capture_id: row.capture_id,
    dispute_id: row.dispute_id,
    mode: row.mode,
    verdict: row.verdict,
    reason_codes: row.reason_codes,
    tool: str(p.tool),
    amount: str(p.args?.amount) ?? str(p.amount?.value),
    hash: row.hash,
    prev_hash: row.prev_hash,
    payload: row.payload,
  };
}

/** Ledger browsing, chain verification and export for the operator console (Phase 7). */
export function mountLedger(app: Hono, opts: LedgerOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const denied = (c: Context) => {
    const a = auth(c);
    return a === "ok" ? null : c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
  };

  app.get("/v1/ledger", async (c) => {
    const no = denied(c);
    if (no) return no;
    const q = PageQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "invalid_request" }, 400);
    const [rows, total] = await Promise.all([opts.page({ beforeSeq: q.data.before_seq, limit: q.data.limit }), opts.count()]);
    const last = rows.at(-1);
    return c.json({ rows: rows.map(ledgerView), next_before_seq: rows.length === q.data.limit && last ? last.seq : null, total });
  });

  app.get("/v1/ledger/verify", async (c) => {
    const no = denied(c);
    if (no) return no;
    const chain = await opts.chain();
    const check = verifyChain(chain.map((r) => r.record));
    if (check.ok) return c.json({ ok: true, count: chain.length });
    return c.json({ ok: false, count: chain.length, broken_at_seq: chain[check.index]!.seq, problem: check.reason });
  });

  app.get("/v1/ledger/export.json", async (c) => {
    const no = denied(c);
    if (no) return no;
    const rows: LedgerPageRow[] = [];
    let beforeSeq: number | undefined;
    // readLedgerPage caps a page at 2,000 rows.
    while (rows.length < EXPORT_MAX) {
      const page = await opts.page({ beforeSeq, limit: Math.min(2000, EXPORT_MAX - rows.length) });
      rows.push(...page);
      if (page.length < 2000) break;
      beforeSeq = page.at(-1)!.seq;
    }
    return c.body(JSON.stringify(rows.map(ledgerView)), 200, {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="keel-ledger.json"',
      "cache-control": "no-store",
    });
  });

  // After /verify and /export.json, which match first.
  app.get("/v1/ledger/:seq", async (c) => {
    const no = denied(c);
    if (no) return no;
    const raw = c.req.param("seq");
    const found = SEQ.test(raw) ? await opts.entry(Number(raw)) : null;
    if (!found) return c.json({ error: "not_found" }, 404);
    const { row, prev, next } = found;
    const { hash, prev_hash, seq: _seq, created_at: _at, ...content } = row;
    return c.json({
      entry: ledgerView(row),
      prev,
      next,
      // This entry alone: its hash recomputed from its content, and its link to the entry before it.
      hash_ok: hashEntry(content, prev_hash) === hash,
      link_ok: prev_hash === (prev?.hash ?? null),
    });
  });
}
