import type { LedgerContent } from "@keel/engine";
import type { OrderDetails } from "@keel/paypal";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { GatewayDeps, StoreOrder } from "../gateway/handle";
import { type ReviewOptions, type ReviewStore, mountReview } from "./review";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const NOW = new Date("2026-10-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const auth = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });
const headers = auth(operatorKey);

const refundPolicy = {
  policy_id: "refund-standard",
  version: 1,
  type: "REFUND",
  approved_text: "Unused items can be refunded within 30 days of delivery, up to the amount you paid.",
  rules: [
    { rule: "max_amount_le_captured_minus_refunded" },
    { rule: "within_days_of", field: "delivered_at", days: 30 },
    { rule: "payer_verified" },
    { rule: "session_budget_le", amount: "100.00" },
    { rule: "daily_budget_le", amount: "500.00" },
    { rule: "auto_approve_le", amount: "50.00" },
  ],
};
const discountPolicy = {
  policy_id: "discount-goodwill",
  version: 1,
  type: "DISCOUNT",
  approved_text: "Up to 10% off your next order.",
  rules: [{ rule: "discount_percent_le", percent: 10 }],
};

const totals: Record<string, string> = { "IN-POLICY": "42.00", LARGE: "120.00" };
const storeOrder = (orderId: string): StoreOrder => ({
  orderId,
  captureId: `CAP-${orderId}`,
  payerEmail: "maya@demo.keel.test",
  currency: "USD",
  total: totals[orderId]!,
  items: [],
  deliveredAt: daysAgo(3),
});
const paypalOrder = (orderId: string, refunded?: string): OrderDetails => ({
  id: orderId,
  status: "COMPLETED",
  purchase_units: [
    {
      payments: {
        captures: [
          { id: `CAP-${orderId}`, status: "COMPLETED", amount: { value: totals[orderId]!, currency_code: "USD" }, create_time: daysAgo(5).toISOString() },
        ],
        ...(refunded ? { refunds: [{ id: "R-0", status: "COMPLETED", amount: { value: refunded, currency_code: "USD" } }] } : {}),
      },
    },
  ],
});

type Row = LedgerContent & { created_at: string };

const held = (decision_id: string, tool: string, reason: LedgerContent["reason_codes"][number], args: Record<string, unknown>, session_id = "ses_1"): LedgerContent => ({
  decision_id,
  session_id,
  order_id: typeof args.order_id === "string" ? args.order_id : null,
  capture_id: null,
  dispute_id: null,
  mode: "QUARANTINE",
  verdict: "HOLD",
  reason_codes: [reason],
  payload: { tool, args },
});

function setup(over: Partial<GatewayDeps> = {}, detail: ReviewOptions["detail"] = async () => ({ score: 72 })) {
  const ledger: Row[] = [];
  let n = 0;
  const sessions = new Map([
    ["ses_1", { id: "ses_1", agent_id: "agt", verified_payer: "maya@demo.keel.test", order_ids: ["IN-POLICY", "LARGE"], state: "QUARANTINED", created_at: "2026-10-27T10:00:00.000Z" }],
    ["ses_2", { id: "ses_2", agent_id: "agt", verified_payer: null, order_ids: [] as string[], state: "ESCALATED", created_at: "2026-10-27T09:00:00.000Z" }],
    ["ses_3", { id: "ses_3", agent_id: "agt", verified_payer: null, order_ids: ["IN-POLICY"], state: "ACTIVE", created_at: "2026-10-27T08:00:00.000Z" }],
  ]);
  const push = (c: LedgerContent) => void ledger.push({ ...c, created_at: new Date(NOW.getTime() + ledger.length * 1000).toISOString() });
  const isResolved = (id: string) =>
    ledger.some((r) => {
      const p = r.payload as { tool?: string; ref?: string; resolved?: boolean };
      return p.tool === "review" && p.ref === id && p.resolved === true;
    });
  const toEntry = (r: Row) => {
    const p = r.payload as { tool: string; args?: Record<string, unknown> };
    return { ...r, tool: p.tool, args: p.args ?? {} };
  };
  const pending = () =>
    ledger
      .filter((r) => r.verdict === "HOLD" && ["offer_refund", "offer_discount"].includes((r.payload as { tool: string }).tool) && !isResolved(r.decision_id))
      .reverse();
  const store: ReviewStore = {
    pendingHeld: async () => pending().map((r) => ({ ...toEntry(r), session_id: r.session_id!, session_state: sessions.get(r.session_id!)!.state })),
    flaggedSessions: async () =>
      [...sessions.values()]
        .filter((s) => ["QUARANTINED", "ESCALATED"].includes(s.state) && !pending().some((r) => r.session_id === s.id))
        .map((s) => ({ session_id: s.id, session_state: s.state, reason_codes: [], created_at: s.created_at })),
    entry: async (id) => {
      const r = ledger.find((e) => e.decision_id === id);
      return r ? toEntry(r) : null;
    },
    isResolved: async (id) => isResolved(id),
    paymentUnconfirmed: async (id) =>
      ledger.some((r) => {
        const p = r.payload as { tool?: string; action?: string; ref?: string; execution?: { status?: string } };
        return p.execution?.status === "FAILED" && (r.decision_id === id || (p.tool === "review" && p.action === "approve" && p.ref === id));
      }),
    session: async (id) => sessions.get(id) ?? null,
    release: async (id, content) => {
      const s = sessions.get(id);
      if (!s) return "not_found";
      if (!["QUARANTINED", "ESCALATED"].includes(s.state)) return "not_flagged";
      s.state = "ACTIVE";
      push(content);
      return "released";
    },
  };
  const gateway: GatewayDeps = {
    getOrderDetails: vi.fn(async (id: string) => paypalOrder(id)),
    refundCapture: vi.fn(async () => ({ id: "REFUND-1", status: "COMPLETED" })),
    store: async (id) => (totals[id] ? storeOrder(id) : null),
    refundTotals: async () => ({ session_refunded: "0.00", daily_refunded: "0.00" }),
    policy: async (id) => ({ "refund-standard": refundPolicy, "discount-goodwill": discountPolicy })[id] ?? null,
    appendLedger: async (c) => push(c),
    escalate: async () => {},
    withOrderLock: vi.fn((_session: string, _order: string, fn: () => Promise<unknown>) => fn()) as GatewayDeps["withOrderLock"],
    control: async () => ({ state: "ACTIVE", agent_frozen: false, score: 0 }),
    assess: async () => ({}),
    notifyHeld: async () => {},
    now: () => NOW,
    newId: (prefix) => `${prefix}_${++n}abcdefgh`,
    ...over,
  };
  const opts: ReviewOptions = { operatorKey, merchantKey, store, gateway, detail };
  const app = new Hono();
  mountReview(app, opts);

  push(held("dec_refund", "offer_refund", "RISK_THRESHOLD", { order_id: "IN-POLICY", amount: "42.00", reason: "damaged", policy_id: "refund-standard" }));
  push(held("dec_large", "offer_refund", "ABOVE_AUTO_APPROVE", { order_id: "LARGE", amount: "80.00", reason: "damaged", policy_id: "refund-standard" }));
  push(held("dec_disc", "offer_discount", "AGENT_FROZEN", { percent: 5, policy_id: "discount-goodwill" }));
  push({ ...held("dec_read", "get_order", "OK", { order_id: "IN-POLICY" }), verdict: "ALLOW" });
  return { app, ledger, gateway, sessions, push };
}

const list = async (app: Hono) => ((await (await app.request("/v1/review", { headers })).json()) as { items: { kind: string; decision_id?: string; session_id: string; score: number | null; session_state: string; tool?: string; args?: unknown }[] }).items;
const act = (app: Hono, id: string, action: "approve" | "deny", body: unknown = { reviewer: "ops@shop" }, h = headers) =>
  app.request(`/v1/review/${id}/${action}`, { method: "POST", headers: h, body: JSON.stringify(body) });
const reviews = (ledger: Row[], ref: string) =>
  ledger.filter((r) => (r.payload as { tool: string; ref?: string }).tool === "review" && (r.payload as { ref?: string }).ref === ref);

describe("review queue auth", () => {
  it("rejects a missing or wrong key with 401 and the merchant key with 403", async () => {
    const { app } = setup();
    expect((await app.request("/v1/review")).status).toBe(401);
    expect((await app.request("/v1/review", { headers: auth("x".repeat(32)) })).status).toBe(401);
    expect((await app.request("/v1/review", { headers: auth(merchantKey) })).status).toBe(403);
    expect((await act(app, "dec_refund", "approve", { reviewer: "a" }, auth(merchantKey))).status).toBe(403);
    expect((await act(app, "dec_refund", "deny", { reviewer: "a" }, auth(merchantKey))).status).toBe(403);
    expect((await app.request("/v1/sessions/ses_1/release", { method: "POST", headers: auth(merchantKey), body: "{}" })).status).toBe(403);
  });
});

describe("GET /v1/review", () => {
  it("lists pending held money actions newest first, and flagged sessions without held actions", async () => {
    const { app } = setup();
    const items = await list(app);
    expect(items.map((i) => i.decision_id ?? i.session_id)).toEqual(["dec_disc", "dec_large", "dec_refund", "ses_2"]);
    expect(items[2]).toMatchObject({ kind: "held_action", tool: "offer_refund", session_id: "ses_1", score: 72, session_state: "QUARANTINED", reason_codes: ["RISK_THRESHOLD"], args: { amount: "42.00" } });
    expect(items[3]).toMatchObject({ kind: "session", session_id: "ses_2", session_state: "ESCALATED", reason_codes: [] });
  });

  it("reports a null score when risk detail fails", async () => {
    const { app } = setup({}, async () => Promise.reject(new Error("db")));
    expect((await list(app)).map((i) => i.score)).toEqual([null, null, null, null]);
  });
});

describe("POST /v1/review/:id/deny", () => {
  it("records a resolved deny and drops the item from the queue", async () => {
    const { app, ledger, gateway } = setup();
    const res = await act(app, "dec_refund", "deny");
    expect(res.status).toBe(200);
    const [row] = reviews(ledger, "dec_refund");
    expect(row).toMatchObject({ verdict: "BLOCK", reason_codes: ["RISK_THRESHOLD"], mode: "LIVE", session_id: "ses_1", order_id: "IN-POLICY" });
    expect(row!.payload).toMatchObject({ action: "deny", reviewer: "ops@shop", resolved: true });
    expect((await list(app)).some((i) => i.decision_id === "dec_refund")).toBe(false);
    expect(gateway.refundCapture).not.toHaveBeenCalled();
    expect((await act(app, "dec_refund", "deny")).status).toBe(409);
    expect((await act(app, "dec_refund", "approve")).status).toBe(409);
  });
});

describe("POST /v1/review/:id/approve", () => {
  it("executes a held refund once, keyed by the held decision id; a second approve is 409", async () => {
    const { app, ledger, gateway } = setup();
    const res = await act(app, "dec_refund", "approve");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision_id: string; execution: unknown };
    expect(body.execution).toEqual({ status: "COMPLETED", refund_id: "REFUND-1", amount: "42.00" });
    expect(gateway.refundCapture).toHaveBeenCalledTimes(1);
    expect(gateway.refundCapture).toHaveBeenCalledWith("CAP-IN-POLICY", { value: "42.00", currency: "USD" }, "dec_refund");
    expect(gateway.withOrderLock).toHaveBeenCalledWith("ses_1", "IN-POLICY", expect.any(Function));
    const [row] = reviews(ledger, "dec_refund");
    expect(row).toMatchObject({ decision_id: body.decision_id, verdict: "ALLOW", reason_codes: ["OK"], capture_id: "CAP-IN-POLICY", mode: "LIVE" });
    expect(row!.payload).toMatchObject({ action: "approve", resolved: true, reviewer: "ops@shop", execution: { status: "COMPLETED" } });
    expect((await list(app)).some((i) => i.decision_id === "dec_refund")).toBe(false);

    expect((await act(app, "dec_refund", "approve")).status).toBe(409);
    expect(gateway.refundCapture).toHaveBeenCalledTimes(1);
  });

  it("re-checks resolution inside the order lock", async () => {
    const { app, ledger, gateway } = setup();
    // Another reviewer resolves it between the first check and taking the lock.
    gateway.withOrderLock = (async (_session: string, _order: string, fn: () => Promise<unknown>) => {
      ledger.push({ ...held("dec_other", "review", "OK", {}), verdict: "BLOCK", payload: { tool: "review", ref: "dec_refund", resolved: true }, created_at: NOW.toISOString() });
      return fn();
    }) as GatewayDeps["withOrderLock"];
    expect((await act(app, "dec_refund", "approve")).status).toBe(409);
    expect(gateway.refundCapture).not.toHaveBeenCalled();
  });

  it("fails with 422 when fresh facts show the refund is over captured, recorded resolved, without touching PayPal refunds", async () => {
    const { app, ledger, gateway } = setup({ getOrderDetails: vi.fn(async (id: string) => paypalOrder(id, "10.00")) });
    const res = await act(app, "dec_refund", "approve");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "blocked", reason_code: "AMOUNT_EXCEEDS_CAPTURED" });
    expect(gateway.refundCapture).not.toHaveBeenCalled();
    const [row] = reviews(ledger, "dec_refund");
    expect(row).toMatchObject({ verdict: "BLOCK", reason_codes: ["AMOUNT_EXCEEDS_CAPTURED"] });
    expect(row!.payload).toMatchObject({ resolved: true });
    expect((await list(app)).some((i) => i.decision_id === "dec_refund")).toBe(false);
  });

  it("executes an ABOVE_AUTO_APPROVE hold", async () => {
    const { app, gateway } = setup();
    const res = await act(app, "dec_large", "approve");
    expect(res.status).toBe(200);
    expect(gateway.refundCapture).toHaveBeenCalledWith("CAP-LARGE", { value: "80.00", currency: "USD" }, "dec_large");
  });

  it("returns 502 on a PayPal failure, recorded FAILED and unresolved, still listed", async () => {
    const { app, ledger } = setup({ refundCapture: vi.fn(async () => Promise.reject(new Error("boom"))) });
    expect((await act(app, "dec_refund", "approve")).status).toBe(502);
    const [row] = reviews(ledger, "dec_refund");
    expect(row).toMatchObject({ verdict: "HOLD" });
    expect(row!.payload).toMatchObject({ resolved: false, execution: { status: "FAILED" } });
    expect((await list(app)).some((i) => i.decision_id === "dec_refund")).toBe(true);
  });

  it("blocks deny while a PayPal failure is unconfirmed; an idempotent re-approve settles it", async () => {
    const refundCapture = vi.fn(async () => Promise.reject(new Error("timeout")));
    const { app, gateway } = setup({ refundCapture });
    expect((await act(app, "dec_refund", "approve")).status).toBe(502);
    const res = await act(app, "dec_refund", "deny");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "payment_unconfirmed" });
    refundCapture.mockImplementation(async () => ({ id: "REFUND-1", status: "COMPLETED" }) as never);
    expect((await act(app, "dec_refund", "approve")).status).toBe(200);
    expect(gateway.refundCapture).toHaveBeenNthCalledWith(1, "CAP-IN-POLICY", { value: "42.00", currency: "USD" }, "dec_refund");
    expect(gateway.refundCapture).toHaveBeenNthCalledWith(2, "CAP-IN-POLICY", { value: "42.00", currency: "USD" }, "dec_refund");
  });

  it("blocks deny of a gateway hold whose own PayPal call failed", async () => {
    const { app, push } = setup();
    const h = held("dec_failed", "offer_refund", "VERIFIER_UNAVAILABLE", { order_id: "IN-POLICY", amount: "5.00", reason: "x", policy_id: "refund-standard" });
    push({ ...h, payload: { ...(h.payload as object), execution: { status: "FAILED", amount: "5.00" } } });
    expect((await act(app, "dec_failed", "deny")).status).toBe(409);
  });

  it("422s a budget hold but keeps it queued (it may clear later)", async () => {
    const { app, ledger, gateway } = setup({ refundTotals: async () => ({ session_refunded: "0.00", daily_refunded: "480.00" }) });
    const res = await act(app, "dec_refund", "approve");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "blocked", reason_code: "BUDGET_EXCEEDED" });
    expect(gateway.refundCapture).not.toHaveBeenCalled();
    expect(reviews(ledger, "dec_refund")[0]).toMatchObject({ verdict: "HOLD", reason_codes: ["BUDGET_EXCEEDED"], payload: { resolved: false } });
    expect((await list(app)).some((i) => i.decision_id === "dec_refund")).toBe(true);
  });

  it("re-checks capability scope: a foreign order or a used-up cap is 422", async () => {
    const { app, push, gateway, ledger } = setup();
    push(held("dec_foreign", "offer_refund", "RISK_THRESHOLD", { order_id: "LARGE", amount: "10.00", reason: "x", policy_id: "refund-standard" }, "ses_3"));
    const res = await act(app, "dec_foreign", "approve");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "blocked", reason_code: "CAPABILITY_OUT_OF_SCOPE" });
    expect(reviews(ledger, "dec_foreign")[0]!.payload).toMatchObject({ resolved: true });

    const used = setup({ refundTotals: async () => ({ session_refunded: "70.00", daily_refunded: "70.00" }) });
    const res2 = await act(used.app, "dec_refund", "approve");
    expect(res2.status).toBe(422);
    expect(await res2.json()).toEqual({ error: "blocked", reason_code: "CAPABILITY_OUT_OF_SCOPE" });
    expect(gateway.refundCapture).not.toHaveBeenCalled();
    expect(used.gateway.refundCapture).not.toHaveBeenCalled();
  });

  it("checks the payer against the session's verified payer", async () => {
    const { app, push, gateway } = setup();
    push(held("dec_unverified", "offer_refund", "RISK_THRESHOLD", { order_id: "IN-POLICY", amount: "10.00", reason: "x", policy_id: "refund-standard" }, "ses_3"));
    const res = await act(app, "dec_unverified", "approve");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "blocked", reason_code: "PAYER_NOT_VERIFIED" });
    expect(gateway.refundCapture).not.toHaveBeenCalled();
  });

  it("returns 503 when facts are unavailable, recorded unresolved", async () => {
    const { app, ledger, gateway } = setup({ getOrderDetails: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect((await act(app, "dec_refund", "approve")).status).toBe(503);
    expect(gateway.refundCapture).not.toHaveBeenCalled();
    expect(reviews(ledger, "dec_refund")[0]!.payload).toMatchObject({ resolved: false });
  });

  it("issues a code for an approved discount", async () => {
    const { app } = setup();
    const res = await act(app, "dec_disc", "approve");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { execution: { status: string; code: string } }).execution).toMatchObject({ status: "ISSUED", code: expect.stringMatching(/^KEEL-[A-Z0-9]{8}$/) });
  });

  it("404s an unknown id, a non-held decision and a malformed id; 400s a bad body", async () => {
    const { app } = setup();
    expect((await act(app, "dec_nope", "approve")).status).toBe(404);
    expect((await act(app, "dec_read", "approve")).status).toBe(404);
    expect((await act(app, "dec_read", "deny")).status).toBe(404);
    expect((await act(app, "not-an-id!", "approve")).status).toBe(404);
    expect((await act(app, "dec_refund", "approve", {})).status).toBe(400);
    expect((await act(app, "dec_refund", "approve", { reviewer: "a", extra: 1 })).status).toBe(400);
    expect((await act(app, "dec_refund", "approve", { reviewer: "x".repeat(65) })).status).toBe(400);
  });
});

describe("POST /v1/sessions/:id/release", () => {
  it("sets the session ACTIVE and appends a release row; held actions stay pending", async () => {
    const { app, ledger, sessions } = setup();
    const res = await app.request("/v1/sessions/ses_1/release", { method: "POST", headers, body: JSON.stringify({ reviewer: "ops@shop" }) });
    expect(res.status).toBe(200);
    expect(sessions.get("ses_1")!.state).toBe("ACTIVE");
    const row = ledger.at(-1)!;
    expect(row).toMatchObject({ session_id: "ses_1", verdict: "ALLOW", reason_codes: ["OK"], mode: "LIVE", payload: { tool: "release", reviewer: "ops@shop" } });
    expect((await list(app)).some((i) => i.decision_id === "dec_refund")).toBe(true);
  });

  it("404s an unknown session and 400s a bad body", async () => {
    const { app } = setup();
    const post = (id: string, body: unknown) => app.request(`/v1/sessions/${id}/release`, { method: "POST", headers, body: JSON.stringify(body) });
    expect((await post("ses_nope", { reviewer: "a" })).status).toBe(404);
    expect((await post("ses_1", { reviewer: "" })).status).toBe(400);
  });

  it("409s a session that isn't quarantined or escalated", async () => {
    const { app, ledger } = setup();
    const before = ledger.length;
    const res = await app.request("/v1/sessions/ses_3/release", { method: "POST", headers, body: JSON.stringify({ reviewer: "a" }) });
    expect(res.status).toBe(409);
    expect(ledger).toHaveLength(before);
  });
});
