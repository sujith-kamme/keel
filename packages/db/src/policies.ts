import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { policies } from "./schema";

/** Highest APPROVED version of a policy as engine policy JSON, or null when there is none. */
export async function activePolicy(db: Db, policyId: string): Promise<unknown> {
  const [row] = await db
    .select()
    .from(policies)
    .where(and(eq(policies.policyId, policyId), eq(policies.status, "APPROVED")))
    .orderBy(desc(policies.version))
    .limit(1);
  if (!row) return null;
  return {
    policy_id: row.policyId,
    version: row.version,
    type: row.type,
    approved_text: row.approvedText,
    rules: row.rules,
  };
}
