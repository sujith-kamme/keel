import type { LedgerContent, Policy } from "@keel/engine";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { type DbOrTx, appendLedger } from "./ledger";
import { ledgerEntries, policies } from "./schema";

/** Highest APPROVED version of a policy as engine policy JSON, or null when there is none. */
export async function activePolicy(db: DbOrTx, policyId: string): Promise<unknown> {
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

export interface PolicyRow {
  policy_id: string;
  version: number;
  type: string;
  approved_text: string;
  rules: unknown;
  status: string;
  created_at: Date;
}
/** Who approved comes from the policy_approve ledger row; seeded versions have none. */
export type PolicyVersion = PolicyRow & { approved_by: string | null; approved_at: Date | null };
export interface PolicySummary {
  policy_id: string;
  type: string;
  active: PolicyRow | null;
  /** The newest DRAFT, only when it is newer than the active version. */
  draft: PolicyRow | null;
}

const toRow = (r: typeof policies.$inferSelect): PolicyRow => ({
  policy_id: r.policyId,
  version: r.version,
  type: r.type,
  approved_text: r.approvedText,
  rules: r.rules,
  status: r.status,
  created_at: r.createdAt,
});

export async function listPolicies(db: DbOrTx): Promise<PolicySummary[]> {
  const rows = await db.select().from(policies).orderBy(policies.policyId, desc(policies.version));
  const out = new Map<string, PolicySummary>();
  for (const r of rows.map(toRow)) {
    const p = out.get(r.policy_id) ?? { policy_id: r.policy_id, type: r.type, active: null, draft: null };
    out.set(r.policy_id, p);
    // Newest first: the first APPROVED is active; a DRAFT counts only before it.
    if (r.status === "APPROVED" && !p.active) {
      p.active = r;
      p.type = r.type;
    }
    if (r.status === "DRAFT" && !p.active && !p.draft) p.draft = r;
  }
  return [...out.values()];
}

/** Every version, newest first. */
export async function policyVersions(db: DbOrTx, policyId: string): Promise<PolicyVersion[]> {
  const [rows, approvals] = await Promise.all([
    db.select().from(policies).where(eq(policies.policyId, policyId)).orderBy(desc(policies.version)),
    db
      .select({ payload: ledgerEntries.payload, createdAt: ledgerEntries.createdAt })
      .from(ledgerEntries)
      .where(sql`${ledgerEntries.payload}->>'tool' = 'policy_approve' and ${ledgerEntries.payload}->>'policy_id' = ${policyId}`),
  ]);
  const byVersion = new Map(approvals.map((a) => [(a.payload as { version?: unknown }).version, a]));
  return rows.map((r) => {
    const a = byVersion.get(r.version);
    const reviewer = (a?.payload as { reviewer?: unknown } | undefined)?.reviewer;
    return { ...toRow(r), approved_by: typeof reviewer === "string" ? reviewer : null, approved_at: a?.createdAt ?? null };
  });
}

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: unknown; cause?: { code?: unknown } };
  return err.code === "23505" || err.cause?.code === "23505";
};

/** Saves a drafted policy as version max + 1 with status DRAFT and returns that version. */
export async function insertDraft(db: DbOrTx, policyId: string, policy: Pick<Policy, "type" | "approved_text" | "rules">): Promise<number> {
  const attempt = () =>
    db.transaction(async (tx) => {
      const [{ top } = { top: null }] = await tx.select({ top: max(policies.version) }).from(policies).where(eq(policies.policyId, policyId));
      const version = (top ?? 0) + 1;
      await tx.insert(policies).values({ policyId, version, type: policy.type, approvedText: policy.approved_text, rules: policy.rules, status: "DRAFT" });
      return version;
    });
  try {
    return await attempt();
  } catch (e) {
    // A concurrent draft took the same version: retry once with the new max.
    if (!isUniqueViolation(e)) throw e;
    return attempt();
  }
}

/**
 * DRAFT → APPROVED with the operator's edits, and the approval's ledger row, in one
 * transaction. False when that version doesn't exist or isn't a DRAFT.
 */
export async function approveVersion(
  db: DbOrTx,
  policyId: string,
  version: number,
  edits: Pick<Policy, "approved_text" | "rules">,
  entry: LedgerContent,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(policies)
      .set({ status: "APPROVED", approvedText: edits.approved_text, rules: edits.rules })
      .where(and(eq(policies.policyId, policyId), eq(policies.version, version), eq(policies.status, "DRAFT")))
      .returning({ id: policies.id });
    if (updated.length === 0) return false;
    await appendLedger(tx, entry);
    return true;
  });
}
