import type { ReasonCode } from "@keel/core";
import { type LedgerContent, Policy } from "@keel/engine";
import { type DraftedPolicy, PolicyDraftRefused, PolicyDraftTimeout } from "@keel/extractor";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { operatorAuth } from "./operator-auth";

export interface PoliciesOptions {
  operatorKey: string;
  merchantKey: string;
  /** Per policy id: the active version and a newer draft. */
  list: () => Promise<unknown[]>;
  /** Every version of a policy, newest first; empty when unknown. */
  versions: (policyId: string) => Promise<unknown[]>;
  /** Highest APPROVED version, or null. */
  active: (policyId: string) => Promise<unknown>;
  /** Throws PolicyDraftRefused, PolicyDraftTimeout or any other error. */
  draft: (input: { current: Policy; document: string }) => Promise<DraftedPolicy>;
  /** Saves version max + 1 as DRAFT and returns it. */
  insertDraft: (policyId: string, policy: DraftedPolicy) => Promise<number>;
  /** DRAFT → APPROVED plus the ledger row, atomically; false when that version isn't a DRAFT. */
  approve: (policyId: string, version: number, edits: Pick<Policy, "approved_text" | "rules">, entry: LedgerContent) => Promise<boolean>;
  /** DRAFT → DISCARDED plus the ledger row, atomically. */
  discard: (policyId: string, version: number, entry: LedgerContent) => Promise<"discarded" | "not_found" | "not_draft">;
  newId: (prefix: string) => string;
  /** Called after an approval commits; failures are logged, never returned. */
  onChange: () => Promise<void>;
}

const POLICY_ID = /^[a-z0-9-]{1,64}$/;
export const DOCUMENT_MAX = 50_000;

const Draft = z.strictObject({
  policy_id: z.string().regex(POLICY_ID),
  document: z.string().max(DOCUMENT_MAX).refine((d) => d.trim().length > 0),
});
// The operator's edited rules are checked by the same schema the engine loads policies with.
const Approve = z.strictObject({
  reviewer: z.string().min(1).max(64),
  approved_text: Policy.shape.approved_text,
  rules: Policy.shape.rules,
});
const Discard = z.strictObject({ reviewer: Approve.shape.reviewer });
const Version = z.string().regex(/^[1-9]\d{0,8}$/).transform(Number);

/** Policy drafting and approval (FR-POL-4/5). A drafted version does nothing until an operator approves it. */
export function mountPolicies(app: Hono, opts: PoliciesOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const denied = (c: Context) => {
    const a = auth(c);
    return a === "ok" ? null : c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
  };

  app.get("/v1/policies", async (c) => {
    const no = denied(c);
    if (no) return no;
    return c.json({ policies: await opts.list() });
  });

  app.get("/v1/policies/:id", async (c) => {
    const no = denied(c);
    if (no) return no;
    const id = c.req.param("id");
    const versions = POLICY_ID.test(id) ? await opts.versions(id) : [];
    if (versions.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ policy_id: id, versions });
  });

  app.post("/v1/policies/draft", async (c) => {
    const no = denied(c);
    if (no) return no;
    const req = Draft.safeParse(await c.req.json().catch(() => null));
    if (!req.success) return c.json({ error: "invalid_request" }, 400);
    // Only existing policies get new versions.
    const current = Policy.safeParse(await opts.active(req.data.policy_id));
    if (!current.success) return c.json({ error: "not_found" }, 404);

    let drafted: DraftedPolicy;
    try {
      drafted = await opts.draft({ current: current.data, document: req.data.document });
    } catch (e) {
      // Never log the document.
      if (e instanceof PolicyDraftRefused) return c.json({ error: "not_understood" }, 422);
      if (e instanceof PolicyDraftTimeout) return c.json({ error: "timeout" }, 504);
      console.warn("policy draft failed:", e instanceof Error ? e.name : "unknown");
      return c.json({ error: "model_unavailable" }, 502);
    }
    const version = await opts.insertDraft(req.data.policy_id, drafted);
    return c.json({ version, policy: { ...drafted, version, status: "DRAFT" } });
  });

  app.post("/v1/policies/:id/versions/:version/approve", async (c) => {
    const no = denied(c);
    if (no) return no;
    const id = c.req.param("id");
    const version = Version.safeParse(c.req.param("version"));
    const req = Approve.safeParse(await c.req.json().catch(() => null));
    if (!POLICY_ID.test(id) || !version.success || !req.success) return c.json({ error: "invalid_request" }, 400);

    const decisionId = opts.newId("dec");
    const approved = await opts.approve(
      id,
      version.data,
      { approved_text: req.data.approved_text, rules: req.data.rules },
      {
        decision_id: decisionId,
        session_id: null,
        order_id: null,
        capture_id: null,
        dispute_id: null,
        mode: "LIVE",
        verdict: "ALLOW",
        reason_codes: ["OK"] as ReasonCode[],
        payload: { tool: "policy_approve", policy_id: id, version: version.data, reviewer: req.data.reviewer },
      },
    );
    if (!approved) return c.json({ error: "not_draft" }, 409);
    opts.onChange().catch((e: unknown) => console.error("recertify failed:", e instanceof Error ? e.name : "unknown"));
    return c.json({ policy_id: id, version: version.data, status: "APPROVED", decision_id: decisionId });
  });

  app.post("/v1/policies/:id/versions/:version/discard", async (c) => {
    const no = denied(c);
    if (no) return no;
    const id = c.req.param("id");
    const version = Version.safeParse(c.req.param("version"));
    const req = Discard.safeParse(await c.req.json().catch(() => null));
    if (!POLICY_ID.test(id) || !version.success || !req.success) return c.json({ error: "invalid_request" }, 400);

    const decisionId = opts.newId("dec");
    const result = await opts.discard(id, version.data, {
      decision_id: decisionId,
      session_id: null,
      order_id: null,
      capture_id: null,
      dispute_id: null,
      mode: "LIVE",
      verdict: "ALLOW",
      reason_codes: ["OK"] as ReasonCode[],
      payload: { tool: "policy_discard", policy_id: id, version: version.data, reviewer: req.data.reviewer },
    });
    if (result === "not_found") return c.json({ error: "not_found" }, 404);
    if (result === "not_draft") return c.json({ error: "not_draft" }, 409);
    return c.json({ policy_id: id, version: version.data, status: "DISCARDED", decision_id: decisionId });
  });
}
