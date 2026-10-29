import { consoleAccount, createDb, sql } from "@keel/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createConsoleStore } from "./console-store";

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
});
