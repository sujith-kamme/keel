import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { anchorCovering, insertAnchor, latestAnchor, ledgerHead } from "./anchors";
import { createDb } from "./client";
import { appendLedger } from "./ledger";
import { ledgerAnchors } from "./schema";

describe.skipIf(!process.env.DATABASE_URL)("ledger anchors (Postgres)", () => {
  const db = createDb();
  // Test anchors carry fake hashes; leaving them would make dev show a bogus "timestamped up to".
  afterAll(() => db.delete(ledgerAnchors).where(eq(ledgerAnchors.tsa, "test")));

  it("reads the head and finds the earliest anchor covering a row", async () => {
    const row = await appendLedger(db, {
      decision_id: `dec_${randomUUID()}`, session_id: null, order_id: null, capture_id: null, dispute_id: null,
      mode: "CONTEXT", verdict: "ALLOW", reason_codes: ["OK"], payload: { test: true },
    });
    const head = await ledgerHead(db);
    expect(head?.hash).toBe(row.hash);
    // Far-future seqs so rows from other tests never sit between them.
    const base = head!.seq + 1_000_000_000;
    const token = Uint8Array.from([1, 2, 3]);
    await insertAnchor(db, { seq: base, hash: "a".repeat(64), tsa: "test", token, signed_at: new Date("2026-11-06T10:00:00Z") });
    await insertAnchor(db, { seq: base + 5, hash: "b".repeat(64), tsa: "test", token, signed_at: new Date("2026-11-06T10:05:00Z") });

    expect((await anchorCovering(db, base + 1))?.hash).toBe("b".repeat(64));
    expect(await anchorCovering(db, base + 6)).toBeNull();
    expect(await latestAnchor(db)).toMatchObject({ seq: base + 5, token, signed_at: new Date("2026-11-06T10:05:00Z") });
  });
});
