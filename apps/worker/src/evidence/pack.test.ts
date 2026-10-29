import { describe, expect, it } from "vitest";
import { type PackInput, buildPack } from "./pack";
import { renderPdf } from "./pdf";

const input: PackInput = {
  dispute: { id: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: { value: "35.00", currency: "USD" }, created_at: "2026-10-28T08:10:34Z" },
  classification: "DEFEND",
  reason_codes: ["DISPUTE_WITHIN_POLICY"],
  order: {
    order_id: "O-1", capture_id: "CAP-1", total: "35.00", currency: "USD",
    delivered_at: "2026-09-13T10:00:00Z", items: [{ title: "Trail Mug", price: "35.00" }],
  },
  paypal: { capture: { id: "CAP-1", status: "COMPLETED", amount: "35.00" }, refunds: [] },
  turns: [
    { session_id: "s1", role: "customer", agent_id: null, text: "I want a refund, email me at maya@demo.keel.test", at: "2026-10-27T09:00:00Z" },
    { session_id: "s1", role: "agent", agent_id: "agt_refund", text: "That order is outside our 30-day refund window.", at: "2026-10-27T09:00:05Z" },
  ],
  rows: [
    { seq: 41, decision_id: "dec-a", at: "2026-10-27T09:00:03Z", tool: "offer_refund", verdict: "BLOCK", reason_codes: ["OUTSIDE_WINDOW"], detail: "refund 35.00 USD on O-1", hash: "h41", prev_hash: "h40" },
    { seq: 42, decision_id: "dec-b", at: "2026-10-27T09:00:05Z", tool: "guard", verdict: "ALLOW", reason_codes: ["OK"], detail: "reply checked", hash: "h42", prev_hash: "h41" },
  ],
  policies: [{ policy_id: "refund-window", version: 3, approved_text: "Refunds within 30 days of delivery." }],
};

describe("buildPack", () => {
  it("lists the refused request with its reason codes in words", () => {
    const pack = buildPack(input);
    const decisions = pack.sections.find((s) => s.heading === "Decisions")!;
    expect(decisions.lines.join("\n")).toContain("BLOCK");
    expect(decisions.lines.join("\n")).toContain("outside the refund window");
  });

  it("includes the policy text and version in force", () => {
    const text = buildPack(input).sections.map((s) => s.lines.join("\n")).join("\n");
    expect(text).toContain("refund-window v3");
    expect(text).toContain("Refunds within 30 days of delivery.");
  });

  it("redacts the transcript", () => {
    const transcript = buildPack(input).sections.find((s) => s.heading === "Conversation")!;
    expect(transcript.lines.join("\n")).toContain("[email]");
    expect(transcript.lines.join("\n")).not.toContain("maya@demo.keel.test");
  });

  it("carries a hash-chain excerpt matching the rows", () => {
    const chain = buildPack(input).sections.find((s) => s.heading === "Ledger hash chain")!;
    expect(chain.lines).toEqual(["#41 dec-a prev h40 hash h41", "#42 dec-b prev h41 hash h42"]);
  });

  it("writes short notes for PayPal with the delivery date and the refusal", () => {
    const { notes } = buildPack(input);
    expect(notes.length).toBeLessThanOrEqual(2000);
    expect(notes).toContain("2026-09-13");
    expect(notes).toContain("outside the refund window");
    expect(notes).not.toContain("maya@demo.keel.test");
  });
});

describe("renderPdf", () => {
  it("renders a PDF under 5 MB for a long transcript", async () => {
    const turns = Array.from({ length: 40 }, (_, i) => ({
      session_id: "s1", role: i % 2 ? "agent" as const : "customer" as const, agent_id: null,
      text: `Message ${i}: ${"a fairly long sentence about the order and the refund ".repeat(6)}`, at: "2026-10-27T09:00:00Z",
    }));
    const bytes = await renderPdf(buildPack({ ...input, turns }));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
  });

  it("doesn't fail on characters the standard font can't draw", async () => {
    const turns = [{ session_id: "s1", role: "customer" as const, agent_id: null, text: "refund pls 🙏 — 退款", at: "2026-10-27T09:00:00Z" }];
    const bytes = await renderPdf(buildPack({ ...input, turns }));
    expect(bytes.length).toBeGreaterThan(0);
  });
});
