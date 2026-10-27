import { describe, expect, it } from "vitest";
import { seal, unseal } from "./seal";

const secret = "s".repeat(32);
const now = new Date("2026-01-01T00:00:00Z");
const later = new Date("2026-01-02T00:00:00Z");

function flip(sealed: string, index: number): string {
  const raw = Buffer.from(sealed, "base64url");
  raw[index] ^= 1;
  return raw.toString("base64url");
}

describe("seal", () => {
  it("round-trips a value", () => {
    const sealed = seal({ token: "abc" }, secret, "chat", later);
    expect(unseal(sealed, secret, "chat", now)).toEqual({ token: "abc" });
  });

  it.each([
    ["iv", 0],
    ["tag", 12],
    ["ciphertext", 28],
  ])("rejects a flipped byte in the %s", (_name, index) => {
    const sealed = seal("x", secret, "chat", later);
    expect(unseal(flip(sealed, index), secret, "chat", now)).toBeNull();
  });

  it("rejects another purpose", () => {
    expect(unseal(seal("x", secret, "chat", later), secret, "console", now)).toBeNull();
  });

  it("rejects another secret", () => {
    expect(unseal(seal("x", secret, "chat", later), "t".repeat(32), "chat", now)).toBeNull();
  });

  it("rejects an expired value", () => {
    expect(unseal(seal("x", secret, "chat", now), secret, "chat", later)).toBeNull();
  });

  it.each(["", "a", "!!!not base64!!!"])("rejects malformed input %j", (input) => {
    expect(unseal(input, secret, "chat", now)).toBeNull();
  });

  it("throws on a short secret", () => {
    expect(() => seal("x", "short", "chat", later)).toThrow(/32 bytes/);
    expect(() => unseal("x", "short", "chat", now)).toThrow(/32 bytes/);
  });
});
