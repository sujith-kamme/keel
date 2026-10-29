import type { ReasonCode } from "@keel/core";
import type { LedgerContent } from "@keel/engine";
import type { Dispute } from "@keel/paypal/disputes";
import { type DisputeAction, type DisputeDeps, type DisputeRow, act } from "@keel/worker/dispute";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { operatorAuth } from "./operator-auth";

export interface DisputeListItem {
  id: string;
  reason: string;
  amount: string;
  currency: string;
  status: string;
  stage: string | null;
  classification: string | null;
  reason_codes: string[];
  action: string | null;
  action_error: string | null;
  outcome: string;
  created_at: string;
  updated_at: string;
}

export interface DisputeLedgerView {
  seq: number;
  decision_id: string;
  session_id: string | null;
  tool: string;
  verdict: string;
  reason_codes: string[];
  args: Record<string, unknown> | null;
  action: string | null;
  reviewer: string | null;
  hash: string;
  created_at: string;
}

export interface DisputeDetail extends DisputeListItem {
  capture_id: string | null;
  order_id: string | null;
  injection: string | null;
  decision_id: string | null;
  evidence_type: string | null;
  evidence_notes: string | null;
  evidence_sha256: string | null;
  has_evidence: boolean;
  buyer_messages: string[];
  /** Actions PayPal currently offers the merchant. */
  offered: string[];
  /** Keel's own rows for this dispute: the classification and any operator actions. */
  decisions: DisputeLedgerView[];
  /** The matched ledger rows the classification was based on. */
  evidence: DisputeLedgerView[];
}

export interface DisputeApiStore {
  list: (limit: number) => Promise<DisputeListItem[]>;
  /** When a poll last reached PayPal; null before the first one. */
  lastSyncedAt: () => Promise<string | null>;
  detail: (id: string) => Promise<DisputeDetail | null>;
  row: (id: string) => Promise<DisputeRow | null>;
  pdf: (id: string) => Promise<Uint8Array | null>;
}

export interface DisputesOptions {
  operatorKey: string;
  merchantKey: string;
  store: DisputeApiStore;
  /** The worker's dispute dependencies: operator actions go through the same `act`. */
  deps: DisputeDeps;
  appendLedger: (c: LedgerContent) => Promise<unknown>;
  enqueueSync: (id: string) => Promise<void>;
  enqueuePoll: () => Promise<void>;
  /** Sandbox-only helpers; undefined against live PayPal (the routes then 404). */
  sandbox?: { escalate: (id: string) => Promise<unknown>; adjudicate: (id: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR") => Promise<unknown> };
  /** PayPal webhook verification; null when PAYPAL_WEBHOOK_ID isn't set. */
  webhook: ((headers: Record<string, string | undefined>, rawBody: string) => Promise<boolean>) | null;
  now: () => Date;
  newId: (prefix: string) => string;
}

export const DISPUTE_ID = /^[A-Za-z0-9-]{1,64}$/;
const Reviewer = z.strictObject({ reviewer: z.string().min(1).max(64) });
const Adjudicate = z.strictObject({ outcome: z.enum(["SELLER_FAVOR", "BUYER_FAVOR"]) });
const Lookup = z.strictObject({ dispute_id: z.string().regex(DISPUTE_ID) });
const WEBHOOK_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
const DISPUTE_EVENTS = new Set(["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"]);
// An operator can act on a dispute nobody acted on yet, or retry one that failed.
const OPERATOR_FROM: (DisputeAction | null)[] = [null, "AWAITING_OPERATOR", "WAITING_ON_PAYPAL", "FAILED"];

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

const shortError = (e: unknown) => {
  const b = (e as { body?: { details?: { issue?: string }[] } }).body;
  return b?.details?.[0]?.issue ?? "paypal_error";
};

export function mountDisputes(app: Hono, opts: DisputesOptions): void {
  const auth = operatorAuth(opts.operatorKey, opts.merchantKey);
  const denied = (c: Context) => {
    const a = auth(c);
    return a === "ok" ? null : c.json({ error: a === 401 ? "unauthorized" : "forbidden" }, a);
  };
  const idParam = (c: Context) => {
    const id = c.req.param("id") ?? "";
    return DISPUTE_ID.test(id) ? id : null;
  };

  const enqueueRefresh = (id: string) => void opts.enqueueSync(id).catch(() => undefined);

  // FR-SEC-3: PayPal signs webhooks; nothing is enqueued unless PayPal confirms the signature.
  app.post(
    "/webhooks/paypal",
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }),
    async (c) => {
      if (!opts.webhook) return c.json({ error: "webhook_not_configured" }, 503);
      const raw = await c.req.text();
      const headers = Object.fromEntries(WEBHOOK_HEADERS.map((h) => [h, c.req.header(h)]));
      let ok: boolean;
      try {
        ok = await opts.webhook(headers, raw);
      } catch {
        return c.json({ error: "verification_unavailable" }, 503); // PayPal retries
      }
      if (!ok) return c.json({ error: "invalid_signature" }, 400);
      const event = JSON.parse(raw) as { event_type?: unknown; resource?: { dispute_id?: unknown } };
      const id = event.resource?.dispute_id;
      if (typeof event.event_type !== "string" || !DISPUTE_EVENTS.has(event.event_type) || typeof id !== "string" || !DISPUTE_ID.test(id)) {
        return c.json({ ignored: true });
      }
      await opts.enqueueSync(id);
      return c.json({ queued: true });
    },
  );

  app.get("/v1/disputes", async (c) => {
    const no = denied(c);
    if (no) return no;
    const [items, lastSyncedAt] = await Promise.all([opts.store.list(50), opts.store.lastSyncedAt()]);
    return c.json({ items, last_synced_at: lastSyncedAt });
  });

  app.post("/v1/disputes/sync", async (c) => {
    const no = denied(c);
    if (no) return no;
    await opts.enqueuePoll();
    return c.json({ queued: true }, 202);
  });

  // The list endpoint lags new disputes by minutes; an operator can fetch one by case id.
  app.post("/v1/disputes/lookup", async (c) => {
    const no = denied(c);
    if (no) return no;
    const req = await body(c, Lookup);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    await opts.enqueueSync(req.dispute_id);
    return c.json({ queued: true }, 202);
  });

  app.get("/v1/disputes/:id", async (c) => {
    const no = denied(c);
    if (no) return no;
    const id = idParam(c);
    const detail = id ? await opts.store.detail(id) : null;
    return detail ? c.json({ ...detail, sandbox: opts.sandbox !== undefined }) : c.json({ error: "not_found" }, 404);
  });

  app.get("/v1/disputes/:id/evidence.pdf", async (c) => {
    const no = denied(c);
    if (no) return no;
    const id = idParam(c);
    const pdf = id ? await opts.store.pdf(id) : null;
    if (!pdf) return c.json({ error: "not_found" }, 404);
    return c.body(pdf as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="keel-evidence-${id}.pdf"`,
      "cache-control": "no-store",
    });
  });

  const operatorAction = (kind: "evidence" | "accept") => async (c: Context) => {
    const no = denied(c);
    if (no) return no;
    const req = await body(c, Reviewer);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    const id = idParam(c);
    const row = id ? await opts.store.row(id) : null;
    if (!id || !row || !row.classification) return c.json({ error: "not_found" }, 404);
    if (row.outcome !== "OPEN") return c.json({ error: "already_resolved" }, 409);
    if (!OPERATOR_FROM.includes(row.action)) return c.json({ error: "already_acted", action: row.action }, 409);
    let d: Dispute;
    try {
      d = await opts.deps.paypal.get(id);
    } catch {
      return c.json({ error: "paypal_unavailable" }, 502);
    }
    const result = await act(opts.deps, d, row, kind, OPERATOR_FROM);
    if (result === "NOT_OFFERED") return c.json({ error: "not_offered", status: d.status }, 409);
    if (result === "BUSY") return c.json({ error: "already_acted" }, 409);
    if (result === "NO_EVIDENCE") return c.json({ error: "no_evidence" }, 409);
    const after = await opts.store.row(id);
    const decisionId = opts.newId("dec");
    await opts.appendLedger({
      decision_id: decisionId,
      session_id: null,
      order_id: null,
      capture_id: row.capture_id,
      dispute_id: id,
      mode: "LIVE",
      verdict: kind === "accept" ? "ALLOW" : "BLOCK",
      reason_codes: ["OK"] as ReasonCode[],
      payload: { tool: "dispute_action", ref: row.decision_id, action: kind === "accept" ? "accept_claim" : "submit_evidence", reviewer: req.reviewer, result: after?.action ?? null },
    });
    enqueueRefresh(id);
    return c.json({ decision_id: decisionId, action: after?.action ?? null }, after?.action === "FAILED" ? 502 : 200);
  };
  app.post("/v1/disputes/:id/submit-evidence", operatorAction("evidence"));
  app.post("/v1/disputes/:id/accept-claim", operatorAction("accept"));


  app.post("/v1/disputes/:id/sandbox/escalate", async (c) => {
    const no = denied(c);
    if (no) return no;
    const id = idParam(c);
    if (!opts.sandbox || !id || !(await opts.store.row(id))) return c.json({ error: "not_found" }, 404);
    try {
      await opts.sandbox.escalate(id);
    } catch (e) {
      return c.json({ error: shortError(e) }, 409);
    }
    enqueueRefresh(id);
    return c.json({ ok: true });
  });

  app.post("/v1/disputes/:id/sandbox/adjudicate", async (c) => {
    const no = denied(c);
    if (no) return no;
    const req = await body(c, Adjudicate);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    const id = idParam(c);
    if (!opts.sandbox || !id || !(await opts.store.row(id))) return c.json({ error: "not_found" }, 404);
    try {
      await opts.sandbox.adjudicate(id, req.outcome);
    } catch (e) {
      return c.json({ error: shortError(e) }, 409);
    }
    enqueueRefresh(id);
    return c.json({ ok: true });
  });
}
