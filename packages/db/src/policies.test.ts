import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { activePolicy } from "./policies";
import { policies } from "./schema";

describe.skipIf(!process.env.DATABASE_URL)("activePolicy (Postgres)", () => {
  const db = createDb();
  const row = (policyId: string, version: number, status: string) => ({
    policyId,
    version,
    type: "POLICY_CLAIM",
    approvedText: `v${version}`,
    rules: [],
    status,
  });

  it("returns the highest approved version and ignores drafts", async () => {
    const id = `test-${randomUUID()}`;
    await db.insert(policies).values([row(id, 1, "APPROVED"), row(id, 2, "APPROVED"), row(id, 3, "DRAFT")]);
    expect(await activePolicy(db, id)).toEqual({
      policy_id: id,
      version: 2,
      type: "POLICY_CLAIM",
      approved_text: "v2",
      rules: [],
    });
  });

  it("returns null when no approved version exists", async () => {
    const id = `test-${randomUUID()}`;
    await db.insert(policies).values(row(id, 1, "DRAFT"));
    expect(await activePolicy(db, id)).toBeNull();
    expect(await activePolicy(db, `missing-${randomUUID()}`)).toBeNull();
  });
});
