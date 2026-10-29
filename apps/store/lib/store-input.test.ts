import { describe, expect, it } from "vitest";
import { ChatBody, safeNext, SessionBody, SignInBody } from "./store-input";

describe("store input", () => {
  it("normalizes the sign-in email", () => {
    expect(SignInBody.parse({ email: " Maya@Gmail.com ", password: "x" }).email).toBe("maya@gmail.com");
    expect(SignInBody.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(SignInBody.safeParse({ email: "maya@gmail.com", password: "" }).success).toBe(false);
  });

  it("takes an order id, not an email, to start a chat", () => {
    expect(SessionBody.safeParse({ order_id: "8KT21976RB4410923" }).success).toBe(true);
    for (const order_id of ["", "../x", "a b", "a".repeat(65)]) expect(SessionBody.safeParse({ order_id }).success).toBe(false);
  });

  it("trims text and bounds its length", () => {
    expect(ChatBody.parse({ text: "  hi  " }).text).toBe("hi");
    expect(ChatBody.safeParse({ text: "" }).success).toBe(false);
    expect(ChatBody.safeParse({ text: "   " }).success).toBe(false);
    expect(ChatBody.safeParse({ text: "a".repeat(1000) }).success).toBe(true);
    expect(ChatBody.safeParse({ text: "a".repeat(1001) }).success).toBe(false);
  });

  it("only returns to paths on this site after sign-in", () => {
    expect(safeNext("/orders/ABC?x=1")).toBe("/orders/ABC?x=1");
    for (const next of ["//evil.test", "https://evil.test", "/\\evil.test", "orders", null, undefined]) expect(safeNext(next)).toBe("/orders");
  });
});
