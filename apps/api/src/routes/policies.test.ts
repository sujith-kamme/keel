import type { Policy } from "@keel/engine";
import { PolicyDraftRefused, PolicyDraftTimeout } from "@keel/extractor";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { type PoliciesOptions, mountPolicies } from "./policies";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const auth = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });

const active: Policy = {
  policy_id: "refund-standard",
  version: 1,
  type: "REFUND",
  approved_text: "Refunds within 30 days.",
  rules: [{ rule: "within_days_of", field: "delivered_at", days: 30 }],
};
const drafted = { policy_id: "refund-standard", type: "REFUND" as const, approved_text: "Refunds within 45 days.", rules: [{ rule: "within_days_of" as const, field: "delivered_at" as const, days: 45 }] };
const edits = { reviewer: "ops@keel.test", approved_text: "Refunds within 40 days.", rules: [{ rule: "within_days_of", field: "delivered_at", days: 40 }] };

function setup(over: Partial<PoliciesOptions> = {}) {
  const opts = {
    list: vi.fn<PoliciesOptions["list"]>(async () => [{ policy_id: "refund-standard", type: "REFUND", active: { ...active, status: "APPROVED" }, draft: null }]),
    versions: vi.fn<PoliciesOptions["versions"]>(async (id) => (id === "refund-standard" ? [{ ...active, status: "APPROVED" }] : [])),
    active: vi.fn<PoliciesOptions["active"]>(async (id) => (id === "refund-standard" ? active : null)),
    draft: vi.fn<PoliciesOptions["draft"]>(async () => drafted),
    insertDraft: vi.fn<PoliciesOptions["insertDraft"]>(async () => 2),
    approve: vi.fn<PoliciesOptions["approve"]>(async () => true),
    discard: vi.fn<PoliciesOptions["discard"]>(async () => "discarded" as const),
    newId: (prefix: string) => `${prefix}_1`,
    onChange: vi.fn<PoliciesOptions["onChange"]>(async () => {}),
    ...over,
  };
  const app = new Hono();
  mountPolicies(app, { operatorKey, merchantKey, ...opts });
  return { app, ...opts };
}

const post = (app: Hono, path: string, body: unknown, key = operatorKey) =>
  app.request(path, { method: "POST", headers: auth(key), body: typeof body === "string" ? body : JSON.stringify(body) });
const APPROVE = "/v1/policies/refund-standard/versions/2/approve";
const DISCARD = "/v1/policies/refund-standard/versions/2/discard";

describe("policies routes", () => {
  it("needs the operator key", async () => {
    const { app } = setup();
    for (const [method, path] of [
      ["GET", "/v1/policies"],
      ["GET", "/v1/policies/refund-standard"],
      ["POST", "/v1/policies/draft"],
      ["POST", APPROVE],
      ["POST", DISCARD],
    ] as const) {
      expect((await app.request(path, { method })).status).toBe(401);
      expect((await app.request(path, { method, headers: auth(merchantKey) })).status).toBe(403);
    }
  });

  it("lists policies and a policy's versions", async () => {
    const { app } = setup();
    const list = await app.request("/v1/policies", { headers: auth(operatorKey) });
    expect(((await list.json()) as { policies: unknown[] }).policies).toHaveLength(1);
    const one = await app.request("/v1/policies/refund-standard", { headers: auth(operatorKey) });
    expect(await one.json()).toEqual({ policy_id: "refund-standard", versions: [{ ...active, status: "APPROVED" }] });
    expect((await app.request("/v1/policies/unknown", { headers: auth(operatorKey) })).status).toBe(404);
    expect((await app.request("/v1/policies/NOT%20AN%20ID", { headers: auth(operatorKey) })).status).toBe(404);
  });

  it("drafts a new version from a document", async () => {
    const { app, draft, insertDraft } = setup();
    const res = await post(app, "/v1/policies/draft", { policy_id: "refund-standard", document: "Refunds within 45 days." });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 2, policy: { ...drafted, version: 2, status: "DRAFT" } });
    expect(draft).toHaveBeenCalledWith({ current: active, document: "Refunds within 45 days." });
    expect(insertDraft).toHaveBeenCalledWith("refund-standard", drafted);
  });

  it("validates draft requests", async () => {
    const { app, draft } = setup();
    for (const body of [
      {},
      { policy_id: "refund-standard" },
      { policy_id: "refund-standard", document: "   " },
      { policy_id: "refund-standard", document: "x".repeat(50_001) },
      { policy_id: "refund-standard", document: "x", extra: 1 },
      { policy_id: "Bad Id", document: "x" },
      "not json",
    ]) {
      expect((await post(app, "/v1/policies/draft", body)).status).toBe(400);
    }
    expect((await post(app, "/v1/policies/draft", { policy_id: "unknown", document: "x" })).status).toBe(404);
    expect(draft).not.toHaveBeenCalled();
  });

  it("accepts a 50,000-character document under the global body limit", async () => {
    const { app: _, ...opts } = setup();
    const app = createApp({ checks: {}, policies: { operatorKey, merchantKey, ...opts } });
    const document = "Refunds within 45 days.\n".repeat(2084).slice(0, 50_000);
    const res = await post(app, "/v1/policies/draft", { policy_id: "refund-standard", document });
    expect(res.status).toBe(200);
  });

  it.each([
    [new PolicyDraftRefused("no"), 422, "not_understood"],
    [new PolicyDraftTimeout("slow"), 504, "timeout"],
    [new Error("boom"), 502, "model_unavailable"],
  ])("maps drafting failures (%s)", async (err, status, error) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { app, insertDraft } = setup({ draft: async () => Promise.reject(err) });
    const res = await post(app, "/v1/policies/draft", { policy_id: "refund-standard", document: "SECRET DOCUMENT" });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(insertDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET DOCUMENT");
    warn.mockRestore();
  });

  it("approves a draft with the operator's edits and records it in the ledger", async () => {
    const { app, approve, onChange } = setup();
    const res = await post(app, APPROVE, edits);
    expect(res.status).toBe(200);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ policy_id: "refund-standard", version: 2, status: "APPROVED", decision_id: "dec_1" });
    expect(approve).toHaveBeenCalledWith("refund-standard", 2, { approved_text: edits.approved_text, rules: edits.rules }, {
      decision_id: "dec_1",
      session_id: null,
      order_id: null,
      capture_id: null,
      dispute_id: null,
      mode: "LIVE",
      verdict: "ALLOW",
      reason_codes: ["OK"],
      payload: { tool: "policy_approve", policy_id: "refund-standard", version: 2, reviewer: "ops@keel.test" },
    });
  });

  it("approves only drafts", async () => {
    const { app, onChange } = setup({ approve: async () => false });
    const res = await post(app, APPROVE, edits);
    expect(res.status).toBe(409);
    expect(onChange).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: "not_draft" });
  });

  it("validates approvals with the Policy schema", async () => {
    const { app, approve, onChange } = setup();
    for (const body of [
      { ...edits, reviewer: "" },
      { ...edits, approved_text: "" },
      { ...edits, rules: [{ rule: "always_refund" }] },
      { ...edits, rules: [{ rule: "auto_approve_le", amount: "$75" }] },
      { ...edits, rules: [{ rule: "within_days_of", field: "delivered_at", days: 0 }] },
      { ...edits, rules: [{ rule: "discount_percent_le", percent: 101 }] },
      { ...edits, extra: true },
    ]) {
      expect((await post(app, APPROVE, body)).status).toBe(400);
    }
    for (const path of ["/v1/policies/refund-standard/versions/0/approve", "/v1/policies/refund-standard/versions/x/approve", "/v1/policies/Bad%20Id/versions/2/approve"]) {
      expect((await post(app, path, edits)).status).toBe(400);
    }
    expect(approve).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards a draft and records it in the ledger", async () => {
    const { app, discard } = setup();
    const res = await post(app, DISCARD, { reviewer: "ops@keel.test" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ policy_id: "refund-standard", version: 2, status: "DISCARDED", decision_id: "dec_1" });
    expect(discard).toHaveBeenCalledWith("refund-standard", 2, {
      decision_id: "dec_1",
      session_id: null,
      order_id: null,
      capture_id: null,
      dispute_id: null,
      mode: "LIVE",
      verdict: "ALLOW",
      reason_codes: ["OK"],
      payload: { tool: "policy_discard", policy_id: "refund-standard", version: 2, reviewer: "ops@keel.test" },
    });
  });

  it("discards only drafts that exist", async () => {
    const missing = setup({ discard: async () => "not_found" as const });
    const res404 = await post(missing.app, DISCARD, { reviewer: "ops@keel.test" });
    expect(res404.status).toBe(404);
    expect(await res404.json()).toEqual({ error: "not_found" });
    const approved = setup({ discard: async () => "not_draft" as const });
    const res409 = await post(approved.app, DISCARD, { reviewer: "ops@keel.test" });
    expect(res409.status).toBe(409);
    expect(await res409.json()).toEqual({ error: "not_draft" });
  });

  it("validates discards", async () => {
    const { app, discard } = setup();
    for (const body of [{}, { reviewer: "" }, { reviewer: "x".repeat(65) }, { reviewer: "ops@keel.test", extra: true }, "not json"]) {
      expect((await post(app, DISCARD, body)).status).toBe(400);
    }
    for (const path of ["/v1/policies/refund-standard/versions/0/discard", "/v1/policies/Bad%20Id/versions/2/discard"]) {
      expect((await post(app, path, { reviewer: "ops@keel.test" })).status).toBe(400);
    }
    expect(discard).not.toHaveBeenCalled();
  });
});
