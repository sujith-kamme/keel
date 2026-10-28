import { randomUUID } from "node:crypto";
import { verifyChain, type LedgerContent } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { appendLedger, readChain, readLedger, readLedgerPage } from "./ledger";
import { sql } from "drizzle-orm";

const content = (): LedgerContent => ({
  decision_id: `dec_${randomUUID()}`,
  session_id: "ses_test",
  order_id: "O-TEST",
  capture_id: null,
  dispute_id: null,
  mode: "CONTEXT",
  verdict: "ALLOW",
  reason_codes: ["OK"],
  payload: { test: true, nested: { b: 2, a: 1 } },
});

describe.skipIf(!process.env.DATABASE_URL)("ledger store (Postgres)", () => {
  const db = createDb();

  it("appends entries that form a valid chain after a jsonb round trip", async () => {
    await appendLedger(db, content());
    await appendLedger(db, content());
    expect(verifyChain(await readLedger(db))).toEqual({ ok: true });
  });

  it("keeps the chain valid under concurrent appends", async () => {
    await Promise.all(Array.from({ length: 20 }, () => appendLedger(db, content())));
    expect(verifyChain(await readLedger(db))).toEqual({ ok: true });
  });

  it("rejects updates and deletes at the database level", async () => {
    const record = await appendLedger(db, content());
    await expect(
      db.execute(sql`update ledger_entries set verdict = 'BLOCK' where decision_id = ${record.decision_id}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from ledger_entries where decision_id = ${record.decision_id}`)).rejects.toThrow();
  });

  it("pages newest first by seq, before a given seq", async () => {
    const ids = [content(), content(), content()];
    for (const c of ids) await appendLedger(db, c);
    const mine = <T extends { decision_id: string }>(rows: T[]) => rows.filter((r) => ids.some((c) => c.decision_id === r.decision_id));

    const page = mine(await readLedgerPage(db, { limit: 2000 }));
    expect(page.map((r) => r.decision_id)).toEqual(ids.map((c) => c.decision_id).reverse());
    expect(page[0]!.seq).toBeGreaterThan(page[1]!.seq);
    expect(page[0]!.created_at).toBeInstanceOf(Date);
    expect(page[0]!.payload).toEqual({ test: true, nested: { a: 1, b: 2 } });

    const older = await readLedgerPage(db, { beforeSeq: page[0]!.seq, limit: 2 });
    expect(older).toHaveLength(2);
    expect(older.every((r) => r.seq < page[0]!.seq)).toBe(true);
    expect(older[0]!.seq).toBeGreaterThan(older[1]!.seq);
  });

  it("clamps the page size to 1..2000", async () => {
    await appendLedger(db, content());
    expect(await readLedgerPage(db, { limit: 0 })).toHaveLength(1);
    expect((await readLedgerPage(db, { limit: 5000 })).length).toBeLessThanOrEqual(2000);
  });

  it("reads the chain in seq order with what verifyChain needs", async () => {
    await appendLedger(db, content());
    const chain = await readChain(db);
    expect(chain[0]!.record.prev_hash).toBeNull();
    expect(chain.every((r, i) => i === 0 || r.seq > chain[i - 1]!.seq)).toBe(true);
    expect(verifyChain(chain.map((r) => r.record))).toEqual({ ok: true });

    const tampered = chain.map((r) => r.record);
    const at = tampered.length - 1;
    tampered[at] = { ...tampered[at]!, verdict: "BLOCK" };
    expect(verifyChain(tampered)).toEqual({ ok: false, index: at, reason: "HASH_MISMATCH" });
  });
});
