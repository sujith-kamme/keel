import { describe, expect, it } from "vitest";
import { checkOtp, newOtp } from "./otp";

const now = new Date("2026-10-27T12:00:00Z");

describe("demo OTP", () => {
  it("issues a 6-digit code that expires in 10 minutes", () => {
    const otp = newOtp(now);
    expect(otp.code).toMatch(/^\d{6}$/);
    expect(otp.expires_at).toBe("2026-10-27T12:10:00.000Z");
    expect(otp.hash).not.toContain(otp.code);
  });

  it("accepts the right code and rejects a wrong one", () => {
    const otp = newOtp(now);
    const stored = { ...otp, attempts: 0 };
    expect(checkOtp(stored, otp.code, now)).toBe("OK");
    const wrong = otp.code === "000000" ? "111111" : "000000";
    expect(checkOtp(stored, wrong, now)).toBe("WRONG");
  });

  it("expires at the boundary", () => {
    const otp = newOtp(now);
    expect(checkOtp({ ...otp, attempts: 0 }, otp.code, new Date("2026-10-27T12:10:00Z"))).toBe("EXPIRED");
  });

  it("locks after 5 attempts even with the right code", () => {
    const otp = newOtp(now);
    expect(checkOtp({ ...otp, attempts: 4 }, otp.code, now)).toBe("OK");
    expect(checkOtp({ ...otp, attempts: 5 }, otp.code, now)).toBe("LOCKED");
  });
});
