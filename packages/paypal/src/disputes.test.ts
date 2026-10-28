import { afterEach, describe, expect, it, vi } from "vitest";
import { type Dispute, acceptClaim, adjudicate, escalate, getDispute, hasAction, listDisputes, pickEvidenceType, provideEvidence, verifyWebhook } from "./disputes";
import { PayPalClient, PayPalError } from "./index";

const sandbox = { clientId: "id", clientSecret: "secret", baseUrl: "https://api-m.sandbox.paypal.com" };
const live = { ...sandbox, baseUrl: "https://api-m.paypal.com" };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stub(respond: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    url.endsWith("/v1/oauth2/token") ? json(200, { access_token: "tok", expires_in: 3600 }) : respond(url, init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const apiCalls = (m: ReturnType<typeof stub>) => m.mock.calls.filter(([url]) => !url.endsWith("/v1/oauth2/token"));

afterEach(() => vi.unstubAllGlobals());

const headers = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-10-28T08:10:35Z",
};

describe("verifyWebhook", () => {
  it("sends the headers, webhook id and the raw event, and accepts SUCCESS", async () => {
    const m = stub(() => json(200, { verification_status: "SUCCESS" }));
    const raw = '{"id":"WH-1","event_type":"CUSTOMER.DISPUTE.CREATED","resource":{"amount":1.10}}';
    expect(await verifyWebhook(new PayPalClient(sandbox), headers, raw, "WEBHOOK-1")).toBe(true);
    const [url, init] = apiCalls(m)[0]!;
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    const body = String(init?.body);
    // The event is embedded byte-for-byte so re-serialising can't break the signature.
    expect(body).toContain(`"webhook_event":${raw}`);
    expect(JSON.parse(body)).toMatchObject({
      auth_algo: "SHA256withRSA", cert_url: headers["paypal-cert-url"], transmission_id: "tx-1",
      transmission_sig: "sig", transmission_time: headers["paypal-transmission-time"], webhook_id: "WEBHOOK-1",
    });
  });

  it("rejects anything but SUCCESS", async () => {
    stub(() => json(200, { verification_status: "FAILURE" }));
    expect(await verifyWebhook(new PayPalClient(sandbox), headers, "{}", "WEBHOOK-1")).toBe(false);
  });

  it("rejects missing headers without calling PayPal", async () => {
    const m = stub(() => json(200, { verification_status: "SUCCESS" }));
    const { "paypal-transmission-sig": _, ...partial } = headers;
    expect(await verifyWebhook(new PayPalClient(sandbox), partial, "{}", "WEBHOOK-1")).toBe(false);
    expect(apiCalls(m)).toHaveLength(0);
  });

  it("rejects a body that isn't JSON without calling PayPal", async () => {
    const m = stub(() => json(200, { verification_status: "SUCCESS" }));
    expect(await verifyWebhook(new PayPalClient(sandbox), headers, '{"a":1}, "webhook_id":"x"', "WEBHOOK-1")).toBe(false);
    expect(apiCalls(m)).toHaveLength(0);
  });

  it("rejects headers PayPal says are malformed", async () => {
    stub(() => json(400, { name: "INVALID_REQUEST", details: [{ field: "/transmission_id", issue: "must match" }] }));
    expect(await verifyWebhook(new PayPalClient(sandbox), headers, "{}", "WEBHOOK-1")).toBe(false);
  });

  it("throws when PayPal's verification call fails, so the caller can ask for a retry", async () => {
    stub(() => json(500, { name: "INTERNAL_SERVICE_ERROR" }));
    await expect(verifyWebhook(new PayPalClient(sandbox), headers, "{}", "WEBHOOK-1")).rejects.toBeInstanceOf(PayPalError);
  });
});

describe("dispute calls", () => {
  it("gets a dispute by case id and rejects ids that could change the path", async () => {
    const m = stub(() => json(200, { dispute_id: "PP-R-PYN-10194897" }));
    const client = new PayPalClient(sandbox);
    await getDispute(client, "PP-R-PYN-10194897");
    expect(apiCalls(m)[0]![0]).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-R-PYN-10194897");
    await expect(getDispute(client, "../v2/payments")).rejects.toThrow("Invalid PayPal resource id");
  });

  it("lists disputes updated after a time", async () => {
    const m = stub(() => json(200, { items: [{ dispute_id: "PP-D-1" }] }));
    const items = await listDisputes(new PayPalClient(sandbox), "2026-10-28T08:00:00.000Z");
    expect(items).toEqual([{ dispute_id: "PP-D-1" }]);
    const url = new URL(apiCalls(m)[0]![0]);
    expect(url.searchParams.get("update_time_after")).toBe("2026-10-28T08:00:00.000Z");
  });

  it("provides evidence as multipart with an input part and the PDF", async () => {
    const m = stub(() => json(200, { links: [] }));
    await provideEvidence(new PayPalClient(sandbox), "PP-D-1", {
      evidence_type: "PROOF_OF_FULFILLMENT",
      notes: "Delivered; conversation record attached.",
      file: { name: "keel-evidence.pdf", bytes: new TextEncoder().encode("%PDF-1.4"), type: "application/pdf" },
    }, "dec-1");
    const [url, init] = apiCalls(m)[0]!;
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-1/provide-evidence");
    const form = init?.body as FormData;
    expect(JSON.parse(await (form.get("input") as Blob).text())).toEqual({
      evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", notes: "Delivered; conversation record attached." }],
    });
    const file = form.get("evidence_file") as File;
    expect(file.name).toBe("keel-evidence.pdf");
    expect(file.type).toBe("application/pdf");
    const sent = init?.headers as Record<string, string>;
    // fetch sets the multipart boundary itself.
    expect(sent["Content-Type"]).toBeUndefined();
    expect(sent["PayPal-Request-Id"]).toBe("dec-1");
  });

  it("accepts a claim as a refund", async () => {
    const m = stub(() => json(200, { links: [] }));
    await acceptClaim(new PayPalClient(sandbox), "PP-D-1", "The agent approved this refund.", "dec-2");
    const [url, init] = apiCalls(m)[0]!;
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-1/accept-claim");
    expect(JSON.parse(String(init?.body))).toEqual({ note: "The agent approved this refund.", accept_claim_type: "REFUND" });
  });

  it("escalates and adjudicates in the sandbox", async () => {
    const m = stub(() => json(200, { links: [] }));
    const client = new PayPalClient(sandbox);
    await escalate(client, "PP-D-1", "Requesting PayPal review.");
    await adjudicate(client, "PP-D-1", "SELLER_FAVOR");
    const [, [url, init]] = apiCalls(m) as [unknown, [string, RequestInit]];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-1/adjudicate");
    expect(JSON.parse(String(init.body))).toEqual({ adjudication_outcome: "SELLER_FAVOR" });
  });

  it("refuses sandbox-only calls against live PayPal", async () => {
    const m = stub(() => json(200, {}));
    const client = new PayPalClient(live);
    await expect(adjudicate(client, "PP-D-1", "SELLER_FAVOR")).rejects.toThrow("sandbox only");
    await expect(escalate(client, "PP-D-1", "x")).rejects.toThrow("sandbox only");
    expect(apiCalls(m)).toHaveLength(0);
  });

  it("throws PayPalError with PayPal's issue on a rejected action", async () => {
    stub(() => json(400, { name: "INVALID_REQUEST", details: [{ issue: "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE" }] }));
    const error = await acceptClaim(new PayPalClient(sandbox), "PP-D-1", "x", "dec-3").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect((error as PayPalError).status).toBe(400);
  });
});

describe("dispute helpers", () => {
  const dispute = (over: Partial<Dispute>): Dispute => ({
    dispute_id: "PP-D-1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_amount: { currency_code: "USD", value: "35.00" },
    disputed_transactions: [{ seller_transaction_id: "CAP-1" }],
    evidences: [],
    links: [],
    ...over,
  });
  const requested = (...types: string[]) => types.map((evidence_type) => ({ evidence_type, source: "REQUESTED_FROM_SELLER" }));

  it("finds actions by their HATEOAS link", () => {
    const d = dispute({ links: [{ rel: "self", href: "x", method: "GET" }, { rel: "provide_evidence", href: "x", method: "POST" }] });
    expect(hasAction(d, "provide_evidence")).toBe(true);
    expect(hasAction(d, "accept_claim")).toBe(false);
  });

  it("picks proof of fulfillment for item-not-received", () => {
    expect(pickEvidenceType(dispute({ evidences: requested("PROOF_OF_FULFILLMENT", "PROOF_OF_REFUND", "OTHER") }), false)).toBe("PROOF_OF_FULFILLMENT");
  });

  it("picks proof of refund when a refund exists and it was requested", () => {
    const d = dispute({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", evidences: requested("PROOF_OF_REFUND", "OTHER") });
    expect(pickEvidenceType(d, true)).toBe("PROOF_OF_REFUND");
  });

  it("falls back to OTHER, then the first requested type", () => {
    const snad = { reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" };
    expect(pickEvidenceType(dispute({ ...snad, evidences: requested("PROOF_OF_REFUND", "OTHER") }), false)).toBe("OTHER");
    expect(pickEvidenceType(dispute({ ...snad, evidences: requested("PROOF_OF_RETURN_SHIPMENT") }), false)).toBe("PROOF_OF_RETURN_SHIPMENT");
  });

  it("ignores evidence the buyer submitted", () => {
    const d = dispute({ evidences: [{ evidence_type: "CREATE", source: "SUBMITTED_BY_BUYER" }, ...requested("OTHER")] });
    expect(pickEvidenceType(d, false)).toBe("OTHER");
  });
});
