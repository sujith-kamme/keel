import { randomUUID } from "node:crypto";
import { verifyChain, type LedgerContent } from "@keel/engine";
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { appendLedger, readLedger } from "./ledger";
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
});
