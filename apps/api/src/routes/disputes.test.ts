import type { LedgerContent } from "@keel/engine";
import type { Dispute } from "@keel/paypal/disputes";
import type { DisputeDeps, DisputeRow } from "@keel/worker/dispute";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type DisputesOptions, mountDisputes } from "./disputes";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const auth = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });
const headers = auth(operatorKey);

const webhookHeaders = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-10-28T08:10:35Z",
  "content-type": "application/json",
};
const event = (type = "CUSTOMER.DISPUTE.CREATED", id: unknown = "PP-R-PYN-10194897") => JSON.stringify({ id: "WH-1", event_type: type, resource: { dispute_id: id } });

const links = (...rels: string[]) => [{ rel: "self", href: "x", method: "GET" }, ...rels.map((rel) => ({ rel, href: "x", method: "POST" }))];
const paypalDispute = (over: Partial<Dispute> = {}): Dispute => ({
  dispute_id: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "WAITING_FOR_SELLER_RESPONSE", dispute_life_cycle_stage: "INQUIRY",
  dispute_amount: { currency_code: "USD", value: "35.00" }, disputed_transactions: [{ seller_transaction_id: "CAP-1" }],
  evidences: [{ evidence_type: "OTHER", source: "REQUESTED_FROM_SELLER" }], links: links("provide_evidence", "accept_claim"), ...over,
});

function setup(over: { row?: Partial<DisputeRow> | null; dispute?: Dispute; webhook?: DisputesOptions["webhook"]; sandbox?: boolean } = {}) {
  let row: (DisputeRow & { error?: string | null }) | null = over.row === null ? null : {
    id: "PP-D-1", capture_id: "CAP-1", classification: "REVIEW", action: "AWAITING_OPERATOR", outcome: "OPEN", decision_id: "dec_c",
    evidence_type: "OTHER", evidence_notes: "notes", evidence_pdf: new TextEncoder().encode("%PDF-1.4"), ...over.row,
  };
  const ledger: LedgerContent[] = [];
  const enqueueSync = vi.fn(async (_id: string) => undefined);
  const enqueuePoll = vi.fn(async () => undefined);
  const paypal = {
    get: vi.fn(async () => over.dispute ?? paypalDispute()),
    list: vi.fn(async () => []),
    refunds: vi.fn(async () => []),
    capture: vi.fn(async () => null),
    provideEvidence: vi.fn(async () => undefined),
    acceptClaim: vi.fn(async () => undefined),
  };
  const deps: DisputeDeps = {
    store: {
      upsert: vi.fn(), context: vi.fn(), classify: vi.fn(), openIds: vi.fn(),
      setAction: async (_id, from, to, error) => {
        if (!row || !from.includes(row.action)) return false;
        row = { ...row, action: to, error };
        return true;
      },
    },
    paypal, scan: vi.fn(), notify: vi.fn(), enqueueSync, autoSubmit: async () => true, consoleUrl: "https://c.test", newId: (p) => `${p}_x`, now: () => new Date(),
  };
  const sandbox = { escalate: vi.fn(async () => undefined), adjudicate: vi.fn(async () => undefined) };
  const app = new Hono();
  mountDisputes(app, {
    operatorKey, merchantKey,
    store: {
      list: async () => [],
      detail: async (id) => (row && id === row.id ? ({ id } as never) : null),
      row: async (id) => (row && id === row.id ? row : null),
      pdf: async (id) => (row && id === row.id ? row.evidence_pdf : null),
    },
    deps,
    appendLedger: async (c) => void ledger.push(c),
    enqueueSync, enqueuePoll,
    sandbox: over.sandbox === false ? undefined : sandbox,
    webhook: over.webhook === undefined ? async () => true : over.webhook,
    now: () => new Date(),
    newId: (p) => `${p}_op`,
  });
  return { app, ledger, enqueueSync, enqueuePoll, paypal, sandbox, row: () => row };
}

describe("POST /webhooks/paypal", () => {
  it("enqueues a sync for a verified dispute event", async () => {
    const t = setup();
    const res = await t.app.request("/webhooks/paypal", { method: "POST", headers: webhookHeaders, body: event() });
    expect(res.status).toBe(200);
    expect(t.enqueueSync).toHaveBeenCalledWith("PP-R-PYN-10194897");
  });

  it("passes the raw body and PayPal headers to verification", async () => {
    const verify = vi.fn(async () => true);
    const t = setup({ webhook: verify });
    const raw = event();
    await t.app.request("/webhooks/paypal", { method: "POST", headers: webhookHeaders, body: raw });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ "paypal-transmission-sig": "sig", "paypal-auth-algo": "SHA256withRSA" }), raw);
  });

  it("rejects a bad signature and enqueues nothing", async () => {
    const t = setup({ webhook: async () => false });
    const res = await t.app.request("/webhooks/paypal", { method: "POST", headers: webhookHeaders, body: event() });
    expect(res.status).toBe(400);
    expect(t.enqueueSync).not.toHaveBeenCalled();
  });

  it("answers 503 when verification can't run, so PayPal retries", async () => {
    const t = setup({ webhook: async () => { throw new Error("paypal down"); } });
    const res = await t.app.request("/webhooks/paypal", { method: "POST", headers: webhookHeaders, body: event() });
    expect(res.status).toBe(503);
    expect(t.enqueueSync).not.toHaveBeenCalled();
  });

  it("answers 503 when no webhook id is configured", async () => {
    const t = setup({ webhook: null });
    expect((await t.app.request("/webhooks/paypal", { method: "POST", headers: webhookHeaders, body: event() })).status).toBe(503);
  });

  it("ignores other events and bad dispute ids", async () => {
    const t = setup();
    for (const body of [event("PAYMENT.CAPTURE.COMPLETED"), event("CUSTOMER.DISPUTE.CREATED", "../x"), event("CUSTOMER.DISPUTE.CREATED", 42)]) {
      const res = await t.app.request("/webhooks/paypal", { method: "POST", headers: webhookHeaders, body });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    }
    expect(t.enqueueSync).not.toHaveBeenCalled();
  });

  it("refuses bodies over 64 KB", async () => {
    const t = setup();
    const res = await t.app.request("/webhooks/paypal", { method: "POST", headers: webhookHeaders, body: "x".repeat(70_000) });
    expect(res.status).toBe(413);
  });
});

describe("operator disputes API", () => {
  it("requires the operator key", async () => {
    const t = setup();
    expect((await t.app.request("/v1/disputes")).status).toBe(401);
    expect((await t.app.request("/v1/disputes", { headers: auth(merchantKey) })).status).toBe(403);
    expect((await t.app.request("/v1/disputes", { headers })).status).toBe(200);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    const t = setup();
    expect((await t.app.request("/v1/disputes/PP-NOPE", { headers })).status).toBe(404);
    expect((await t.app.request("/v1/disputes/bad%2Fid", { headers })).status).toBe(404);
  });

  it("serves the evidence PDF", async () => {
    const t = setup();
    const res = await t.app.request("/v1/disputes/PP-D-1/evidence.pdf", { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.4");
  });

  it("looks up a case id and polls on demand", async () => {
    const t = setup();
    expect((await t.app.request("/v1/disputes/lookup", { method: "POST", headers, body: JSON.stringify({ dispute_id: "PP-R-PYN-10194897" }) })).status).toBe(202);
    expect(t.enqueueSync).toHaveBeenCalledWith("PP-R-PYN-10194897");
    expect((await t.app.request("/v1/disputes/lookup", { method: "POST", headers, body: JSON.stringify({ dispute_id: "a/b" }) })).status).toBe(400);
    expect((await t.app.request("/v1/disputes/sync", { method: "POST", headers })).status).toBe(202);
    expect(t.enqueuePoll).toHaveBeenCalledTimes(1);
  });

  it("lets the operator accept a claim and records it in the ledger", async () => {
    const t = setup();
    const res = await t.app.request("/v1/disputes/PP-D-1/accept-claim", { method: "POST", headers, body: JSON.stringify({ reviewer: "ops" }) });
    expect(res.status).toBe(200);
    expect(t.paypal.acceptClaim).toHaveBeenCalledTimes(1);
    expect(t.row()?.action).toBe("CLAIM_ACCEPTED");
    expect(t.ledger[0]).toMatchObject({ dispute_id: "PP-D-1", verdict: "ALLOW", payload: { tool: "dispute_action", ref: "dec_c", action: "accept_claim", reviewer: "ops", result: "CLAIM_ACCEPTED" } });
  });

  it("lets the operator submit the evidence pack", async () => {
    const t = setup();
    const res = await t.app.request("/v1/disputes/PP-D-1/submit-evidence", { method: "POST", headers, body: JSON.stringify({ reviewer: "ops" }) });
    expect(res.status).toBe(200);
    expect(t.paypal.provideEvidence).toHaveBeenCalledTimes(1);
  });

  it("refuses to act twice", async () => {
    const t = setup({ row: { action: "EVIDENCE_SUBMITTED" } });
    const res = await t.app.request("/v1/disputes/PP-D-1/accept-claim", { method: "POST", headers, body: JSON.stringify({ reviewer: "ops" }) });
    expect(res.status).toBe(409);
    expect(t.paypal.acceptClaim).not.toHaveBeenCalled();
  });

  it("refuses an action PayPal doesn't offer yet", async () => {
    const t = setup({ dispute: paypalDispute({ links: links() }) });
    const res = await t.app.request("/v1/disputes/PP-D-1/accept-claim", { method: "POST", headers, body: JSON.stringify({ reviewer: "ops" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_offered" });
  });

  it("refuses resolved disputes", async () => {
    const t = setup({ row: { outcome: "WON" } });
    expect((await t.app.request("/v1/disputes/PP-D-1/accept-claim", { method: "POST", headers, body: JSON.stringify({ reviewer: "ops" }) })).status).toBe(409);
  });

  it("validates the reviewer", async () => {
    const t = setup();
    expect((await t.app.request("/v1/disputes/PP-D-1/accept-claim", { method: "POST", headers, body: "{}" })).status).toBe(400);
  });
});

describe("sandbox helpers", () => {
  it("adjudicates in the sandbox", async () => {
    const t = setup();
    const res = await t.app.request("/v1/disputes/PP-D-1/sandbox/adjudicate", { method: "POST", headers, body: JSON.stringify({ outcome: "SELLER_FAVOR" }) });
    expect(res.status).toBe(200);
    expect(t.sandbox.adjudicate).toHaveBeenCalledWith("PP-D-1", "SELLER_FAVOR");
  });

  it("reports PayPal's refusal", async () => {
    const t = setup();
    t.sandbox.adjudicate.mockRejectedValueOnce(Object.assign(new Error("x"), { body: { details: [{ issue: "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE" }] } }));
    const res = await t.app.request("/v1/disputes/PP-D-1/sandbox/adjudicate", { method: "POST", headers, body: JSON.stringify({ outcome: "SELLER_FAVOR" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE" });
  });

  it("doesn't exist against live PayPal", async () => {
    const t = setup({ sandbox: false });
    expect((await t.app.request("/v1/disputes/PP-D-1/sandbox/escalate", { method: "POST", headers })).status).toBe(404);
  });
});
