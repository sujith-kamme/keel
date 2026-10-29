import { randomUUID } from "node:crypto";
import type { LedgerContent } from "@keel/engine";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { appendLedger } from "./ledger";
import { ledgerEntries, settings } from "./schema";
import { readSettings, seedSettings, writeSettings } from "./settings";

const rid = () => randomUUID().replaceAll("-", "");

describe.skipIf(!process.env.DATABASE_URL)("settings (Postgres)", () => {
  const db = createDb();
  const keys: string[] = [];
  const key = () => {
    const k = `test_${rid()}`;
    keys.push(k);
    return k;
  };
  const entry = (decisionId = `dec_${rid()}`): LedgerContent => ({
    decision_id: decisionId,
    session_id: null,
    order_id: null,
    capture_id: null,
    dispute_id: null,
    mode: "LIVE",
    verdict: "ALLOW",
    reason_codes: ["OK"],
    payload: { tool: "settings_update", section: "guard", changes: {}, operator: "test" },
  });
  const ledgerCount = async (id: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.decisionId, id))).length;

  afterEach(async () => {
    await db.delete(settings).where(inArray(settings.key, keys));
    keys.length = 0;
  });

  it("write updates rows and appends exactly one ledger entry", async () => {
    const [a, b] = [key(), key()];
    await seedSettings(db, { [a]: 1, [b]: "x" });
    const id = `dec_${rid()}`;
    await writeSettings(db, { [a]: 2, [b]: null }, "op@test", entry(id));
    const all = await readSettings(db);
    expect(all[a]).toBe(2);
    expect(all[b]).toBeNull();
    const [row] = await db.select().from(settings).where(eq(settings.key, a));
    expect(row?.updatedBy).toBe("op@test");
    expect(await ledgerCount(id)).toBe(1);
  });

  it("seed does not overwrite an existing row", async () => {
    const k = key();
    await seedSettings(db, { [k]: "first" });
    await seedSettings(db, { [k]: "second" });
    expect((await readSettings(db))[k]).toBe("first");
    const n = key();
    await seedSettings(db, { [n]: null });
    expect((await readSettings(db))[n]).toBeNull();
    const [row] = await db.select().from(settings).where(eq(settings.key, k));
    expect(row?.updatedBy).toBeNull();
  });

  it("rolls the change back when the ledger append throws", async () => {
    const k = key();
    await seedSettings(db, { [k]: "before" });
    const id = `dec_${rid()}`;
    await appendLedger(db, entry(id));
    // Same decision_id again violates the ledger's unique constraint.
    await expect(writeSettings(db, { [k]: "after" }, "op@test", entry(id))).rejects.toThrow();
    expect((await readSettings(db))[k]).toBe("before");
  });
});
