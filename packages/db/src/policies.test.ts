import { randomUUID } from "node:crypto";
import type { LedgerContent } from "@keel/engine";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import type { DbOrTx } from "./ledger";
import { activePolicy, approveVersion, insertDraft, listPolicies, policyVersions } from "./policies";
import { policies } from "./schema";

// Every write happens in a transaction that is rolled back: the shared dev DB keeps no test rows.
const ROLLBACK = new Error("rollback");
async function scoped(fn: (tx: DbOrTx) => Promise<void>) {
  const db = createDb();
  await expect(
    db.transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    }),
  ).rejects.toBe(ROLLBACK);
}

const row = (policyId: string, version: number, status: string) => ({
  policyId,
  version,
  type: "POLICY_CLAIM",
  approvedText: `v${version}`,
  rules: [],
  status,
});

const refund = { type: "REFUND" as const, approved_text: "Refunds within 45 days.", rules: [{ rule: "within_days_of" as const, field: "delivered_at" as const, days: 45 }] };

const approval = (policyId: string, version: number, reviewer = "ops@keel.test"): LedgerContent => ({
  decision_id: `dec_pol_${randomUUID()}`,
  session_id: null,
  order_id: null,
  capture_id: null,
  dispute_id: null,
  mode: "LIVE",
  verdict: "ALLOW",
  reason_codes: ["OK"],
  payload: { tool: "policy_approve", policy_id: policyId, version, reviewer },
});

describe.skipIf(!process.env.DATABASE_URL)("policies (Postgres)", () => {
  it("activePolicy returns the highest approved version and ignores drafts", () =>
    scoped(async (tx) => {
      const id = `test-${randomUUID()}`;
      await tx.insert(policies).values([row(id, 1, "APPROVED"), row(id, 2, "APPROVED"), row(id, 3, "DRAFT")]);
      expect(await activePolicy(tx, id)).toEqual({ policy_id: id, version: 2, type: "POLICY_CLAIM", approved_text: "v2", rules: [] });
    }));

  it("activePolicy returns null when no approved version exists", () =>
    scoped(async (tx) => {
      const id = `test-${randomUUID()}`;
      await tx.insert(policies).values(row(id, 1, "DRAFT"));
      expect(await activePolicy(tx, id)).toBeNull();
      expect(await activePolicy(tx, `missing-${randomUUID()}`)).toBeNull();
    }));

  it("lists each policy with its active version and a newer draft only", () =>
    scoped(async (tx) => {
      const a = `test-a-${randomUUID()}`;
      const b = `test-b-${randomUUID()}`;
      await tx.insert(policies).values([row(a, 1, "APPROVED"), row(a, 2, "DRAFT"), row(a, 3, "DRAFT"), row(b, 1, "DRAFT"), row(b, 2, "APPROVED")]);
      const list = (await listPolicies(tx)).filter((p) => p.policy_id === a || p.policy_id === b);
      expect(list.map((p) => [p.policy_id, p.type, p.active?.version ?? null, p.draft?.version ?? null])).toEqual([
        [a, "POLICY_CLAIM", 1, 3],
        [b, "POLICY_CLAIM", 2, null],
      ]);
    }));

  it("inserts drafts as the next version", () =>
    scoped(async (tx) => {
      const id = `test-${randomUUID()}`;
      await tx.insert(policies).values(row(id, 1, "APPROVED"));
      expect(await insertDraft(tx, id, refund)).toBe(2);
      expect(await insertDraft(tx, id, refund)).toBe(3);
      const [v3] = await policyVersions(tx, id);
      expect(v3).toMatchObject({ policy_id: id, version: 3, type: "REFUND", status: "DRAFT", approved_text: refund.approved_text, rules: refund.rules });
    }));

  it("gives concurrent drafts distinct versions", async () => {
    const db = createDb();
    const id = `test-${randomUUID()}`;
    try {
      await db.insert(policies).values(row(id, 1, "APPROVED"));
      const versions = await Promise.all([insertDraft(db, id, refund), insertDraft(db, id, refund)]);
      expect(versions.sort()).toEqual([2, 3]);
    } finally {
      await db.delete(policies).where(eq(policies.policyId, id));
    }
  });

  it("approves only drafts, stores the edits and records who approved in the ledger", () =>
    scoped(async (tx) => {
      const id = `test-${randomUUID()}`;
      await tx.insert(policies).values([row(id, 1, "APPROVED"), row(id, 2, "DRAFT")]);
      const edits = { approved_text: "Edited.", rules: [{ rule: "payer_verified" as const }] };
      expect(await approveVersion(tx, id, 2, edits, approval(id, 2))).toBe(true);
      expect(await approveVersion(tx, id, 2, edits, approval(id, 2))).toBe(false);
      expect(await approveVersion(tx, id, 1, edits, approval(id, 1))).toBe(false);
      expect(await approveVersion(tx, id, 9, edits, approval(id, 9))).toBe(false);

      // The engine follows with no other change.
      expect(await activePolicy(tx, id)).toEqual({ policy_id: id, version: 2, type: "POLICY_CLAIM", ...edits });
      const versions = await policyVersions(tx, id);
      expect(versions.map((v) => [v.version, v.status, v.approved_by])).toEqual([
        [2, "APPROVED", "ops@keel.test"],
        [1, "APPROVED", null],
      ]);
      expect(versions[0]!.approved_at).toBeInstanceOf(Date);
      expect(versions[1]!.approved_at).toBeNull();
    }));
});
