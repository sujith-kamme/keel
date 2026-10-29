import { describe, expect, it } from "vitest";
import {
  ConsoleEmail,
  agentLimits,
  isSection,
  passwordErrorMessage,
  passwordProblem,
  sectionValues,
  settingsErrorMessage,
  zapierTestError,
  zapierTestMessage,
} from "./settings-view";

const guard = { extractor_model: "claude-haiku-5-5", extractor_timeout_ms: 4000, risk_threshold: 60, risk_half_life_min: 30 };

describe("settings sections", () => {
  it("knows only the API's sections", () => {
    for (const s of ["guard", "agent", "gauntlet", "disputes", "zapier"]) expect(isSection(s)).toBe(true);
    for (const s of ["account", "toString", "__proto__", 1]) expect(isSection(s)).toBe(false);
  });

  it("accepts in-range values and rejects out-of-range, missing, extra or mistyped ones", () => {
    expect(sectionValues("guard", guard)).toEqual(guard);
    for (const bad of [
      { ...guard, extractor_timeout_ms: 999 },
      { ...guard, extractor_timeout_ms: 10001 },
      { ...guard, risk_threshold: 0 },
      { ...guard, risk_threshold: 101 },
      { ...guard, risk_threshold: 60.5 },
      { ...guard, risk_threshold: Number.NaN },
      { ...guard, risk_half_life_min: 1441 },
      { ...guard, extractor_model: "gpt-4" },
      { ...guard, extra: 1 },
      { extractor_model: "claude-haiku-5-5" },
    ]) {
      expect(sectionValues("guard", bad)).toBeNull();
    }
    const agent = { policy_agent_model: "claude-haiku-5-5", policy_agent_prompt: "lenient", refund_agent_model: "claude-haiku-5-5", refund_agent_prompt: "lenient" };
    expect(sectionValues("gauntlet", { gauntlet_customer_model: "claude-opus-5-5", gauntlet_concurrency: 11 })).toBeNull();
    expect(sectionValues("disputes", { dispute_auto_submit: "true", dispute_poll_seconds: 120 })).toBeNull();
    expect(sectionValues("disputes", { dispute_auto_submit: true, dispute_poll_seconds: 29 })).toBeNull();
    expect(sectionValues("agent", { ...agent, refund_agent_model: "claude-sonnet-5-5", refund_agent_prompt: "strict" })).not.toBeNull();
    expect(sectionValues("agent", { ...agent, refund_agent_prompt: "rude" })).toBeNull();
  });

  it("only stores Zapier hook URLs, or null to remove", () => {
    expect(sectionValues("zapier", { zapier_hook_url: " https://hooks.zapier.com/hooks/catch/1/abc " })).toEqual({ zapier_hook_url: "https://hooks.zapier.com/hooks/catch/1/abc" });
    expect(sectionValues("zapier", { zapier_hook_url: null })).toEqual({ zapier_hook_url: null });
    for (const url of ["http://hooks.zapier.com/x", "https://evil.example/hooks.zapier.com/", "https://hooks.zapier.com.evil.example/"]) {
      expect(sectionValues("zapier", { zapier_hook_url: url })).toBeNull();
    }
  });

  it("maps API errors to messages", () => {
    expect(settingsErrorMessage(400)).toMatch(/out of range/);
    expect(settingsErrorMessage(500)).toBe("Couldn't save the settings. Try again.");
  });
});

describe("zapier test", () => {
  it("reports Zapier's status, or that it could not be reached", () => {
    expect(zapierTestMessage({ ok: true, status: 200 })).toBe("Zapier answered 200");
    expect(zapierTestMessage({ ok: false, status: 410 })).toBe("Zapier answered 410");
    expect(zapierTestMessage({ ok: false, status: null })).toBe("Couldn't reach Zapier");
    expect(zapierTestError(409)).toBe("No hook is saved.");
  });
});

describe("account", () => {
  it("lowercases and validates the email", () => {
    expect(ConsoleEmail.parse(" Ops@Tidewell.com ")).toBe("ops@tidewell.com");
    expect(ConsoleEmail.safeParse("not-an-email").success).toBe(false);
  });

  it("checks the new password before calling the API", () => {
    const ok = "a-long-new-passphrase";
    expect(passwordProblem("current-password", ok, ok)).toBeNull();
    expect(passwordProblem("", ok, ok)).toBe("Enter your current password.");
    expect(passwordProblem("current-password", "short", "short")).toMatch(/12 to 128/);
    expect(passwordProblem("current-password", "x".repeat(129), "x".repeat(129))).toMatch(/12 to 128/);
    expect(passwordProblem("current-password", ok, `${ok}!`)).toBe("The new passwords don't match.");
    expect(passwordProblem(ok, ok, ok)).toMatch(/differ/);
    expect(passwordProblem(undefined, ok, ok)).toBe("Invalid request.");
  });

  it("maps password-change failures", () => {
    expect(passwordErrorMessage(401)).toBe("Current password is wrong");
    expect(passwordErrorMessage(409)).toBe("Password was changed elsewhere; sign in again");
    expect(passwordErrorMessage(429, 61)).toBe("Too many wrong attempts. Try again in 2 minutes.");
    expect(passwordErrorMessage(429, 30)).toBe("Too many wrong attempts. Try again in 1 minute.");
    expect(passwordErrorMessage(503)).toMatch(/unavailable/);
  });
});

describe("agent limits", () => {
  it("lists only the limits the approved rules set", () => {
    expect(
      agentLimits([
        { rule: "session_budget_le", amount: "100.00" },
        { rule: "daily_budget_le", amount: "500.00" },
        { rule: "discount_percent_le", percent: 10 },
        { rule: "payer_verified" },
      ]),
    ).toEqual({ refunds: "$100.00 per conversation · $500.00 per day", discounts: "Up to 10%" });
    expect(agentLimits([{ rule: "daily_budget_le", amount: "50.00" }])).toEqual({ refunds: "$50.00 per day", discounts: null });
    expect(agentLimits([])).toEqual({ refunds: null, discounts: null });
  });
});
