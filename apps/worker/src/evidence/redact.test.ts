import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("masks Luhn-valid card numbers with spaces or dashes", () => {
    expect(redact("card 4032 0393 1798 4658 please")).toBe("card [card] please");
    expect(redact("4032-0393-1798-4658")).toBe("[card]");
    expect(redact("4032039317984658")).toBe("[card]");
  });

  it("keeps long numbers that aren't card numbers (order ids, amounts)", () => {
    expect(redact("order 1234567890123 for 120.00")).toBe("order 1234567890123 for 120.00");
  });

  it("masks phone numbers", () => {
    expect(redact("call me on +1 (415) 555-0134")).toBe("call me on [phone]");
    expect(redact("415.555.0134 or 415 555 0134")).toBe("[phone] or [phone]");
  });

  it("masks emails", () => {
    expect(redact("I'm maya@demo.keel.test")).toBe("I'm [email]");
  });

  it("leaves dates and money alone", () => {
    expect(redact("delivered 2026-10-23, refund $35.00")).toBe("delivered 2026-10-23, refund $35.00");
  });
});
