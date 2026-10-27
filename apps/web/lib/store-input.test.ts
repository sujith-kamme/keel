import { describe, expect, it } from "vitest";
import { ChatBody, SessionBody, VerifyBody } from "./store-input";

describe("store input", () => {
  it("accepts only demo customers", () => {
    expect(SessionBody.safeParse({ email: "maya@demo.keel.test" }).success).toBe(true);
    expect(SessionBody.safeParse({ email: "eve@example.com" }).success).toBe(false);
  });

  it("requires exactly six digits", () => {
    expect(VerifyBody.safeParse({ code: "123456" }).success).toBe(true);
    for (const code of ["12345", "1234567", "12345a", "123456\n", ""]) expect(VerifyBody.safeParse({ code }).success).toBe(false);
  });

  it("trims text and bounds its length", () => {
    expect(ChatBody.parse({ text: "  hi  " }).text).toBe("hi");
    expect(ChatBody.safeParse({ text: "" }).success).toBe(false);
    expect(ChatBody.safeParse({ text: "   " }).success).toBe(false);
    expect(ChatBody.safeParse({ text: "a".repeat(1000) }).success).toBe(true);
    expect(ChatBody.safeParse({ text: "a".repeat(1001) }).success).toBe(false);
  });
});
