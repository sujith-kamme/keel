import { randomUUID } from "node:crypto";
import { appendLedger, consoleAccount, createDb, eq, ledgerEntries, sql } from "@keel/db";
import type { LedgerContent } from "@keel/engine";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createConsoleStore } from "./console-store";

const rid = () => randomUUID().replaceAll("-", "");
const entry = (payload: Record<string, unknown>, decisionId = `dec_${rid()}`): LedgerContent => ({
  decision_id: decisionId,
  session_id: null,
  order_id: null,
  capture_id: null,
  dispute_id: null,
  mode: "LIVE",
  verdict: "ALLOW",
  reason_codes: ["OK"],
  payload,
});

// One row in the shared dev DB: snapshot it, run against an empty table, and restore after.
describe.skipIf(!process.env.DATABASE_URL)("console store (Postgres)", () => {
  const db = createDb();
  const store = createConsoleStore(db);
  let saved: (typeof consoleAccount.$inferSelect)[] = [];

  beforeAll(async () => {
    saved = await db.select().from(consoleAccount);
  });
  beforeEach(async () => {
    await db.delete(consoleAccount);
  });
  afterAll(async () => {
    await db.delete(consoleAccount);
    if (saved.length > 0) await db.insert(consoleAccount).values(saved);
  });

  it("seeds once; a second seed does not overwrite", async () => {
    expect(await store.get()).toBeNull();
    await store.seed("a@example.com", "scrypt$first");
    await store.seed("b@example.com", "scrypt$second");
    expect(await store.get()).toEqual({ email: "a@example.com", passwordHash: "scrypt$first", sessionVersion: 1 });
  });

  it("allows only the single row", async () => {
    await expect(db.insert(consoleAccount).values({ id: 2, email: "x@example.com", passwordHash: "h" })).rejects.toThrow();
    expect((await db.execute(sql`select count(*)::int as n from console_account`)).rows[0]).toEqual({ n: 0 });
  });

  const ledgerRow = async (id: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.decisionId, id)))[0];

  it("email change updates the row and ledgers the previous address, keeping the version", async () => {
    await store.seed("a@example.com", "scrypt$h");
    const e = entry({});
    await store.setEmail("b@example.com", (from) => ({ ...e, payload: { tool: "console_email_change", from, to: "b@example.com", operator: "test" } }));
    expect(await store.get()).toEqual({ email: "b@example.com", passwordHash: "scrypt$h", sessionVersion: 1 });
    expect((await ledgerRow(e.decision_id))?.payload).toEqual({ tool: "console_email_change", from: "a@example.com", to: "b@example.com", operator: "test" });
  });

  it("password change swaps the hash only from the expected one and bumps the version", async () => {
    await store.seed("a@example.com", "scrypt$old");
    const stale = entry({ tool: "console_password_change", operator: "test" });
    expect(await store.setPassword("scrypt$other", "scrypt$new", stale)).toBeNull();
    expect(await ledgerRow(stale.decision_id)).toBeUndefined();
    const [before] = await db.select().from(consoleAccount);
    const e = entry({ tool: "console_password_change", operator: "test" });
    expect(await store.setPassword("scrypt$old", "scrypt$new", e)).toBe(2);
    const [after] = await db.select().from(consoleAccount);
    expect(after).toMatchObject({ passwordHash: "scrypt$new", sessionVersion: 2 });
    expect(after!.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(before!.passwordChangedAt.getTime());
    expect(await ledgerRow(e.decision_id)).toBeDefined();
  });

  it("revoke bumps the version and ledgers it", async () => {
    await store.seed("a@example.com", "scrypt$h");
    const e = entry({ tool: "console_sessions_revoke", operator: "test" });
    expect(await store.revokeSessions(e)).toBe(2);
    expect(await store.revokeSessions(entry({ tool: "console_sessions_revoke", operator: "test" }))).toBe(3);
    expect(await ledgerRow(e.decision_id)).toBeDefined();
  });

  it("rolls the change back when the ledger append throws", async () => {
    await store.seed("a@example.com", "scrypt$old");
    const used = entry({ tool: "test" });
    await appendLedger(db, used);
    // The same decision_id again violates the ledger's unique constraint.
    await expect(store.setPassword("scrypt$old", "scrypt$new", used)).rejects.toThrow();
    await expect(store.revokeSessions(used)).rejects.toThrow();
    await expect(store.setEmail("b@example.com", () => used)).rejects.toThrow();
    expect(await store.get()).toEqual({ email: "a@example.com", passwordHash: "scrypt$old", sessionVersion: 1 });
  });
});
