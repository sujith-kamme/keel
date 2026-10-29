import { describe, expect, it } from "vitest";
import { SECTIONS, SECTION_SCHEMAS, SETTINGS_DEFAULTS, settingsFromEnv, settingsSchema } from "./settings-schema";

const bad = (patch: object) => settingsSchema.safeParse({ ...SETTINGS_DEFAULTS, ...patch }).success;

describe("settings schema", () => {
  it("parses the defaults, and each section covers its own keys", () => {
    expect(settingsSchema.parse(SETTINGS_DEFAULTS)).toEqual(SETTINGS_DEFAULTS);
    const all = Object.values(SECTIONS).flat();
    expect(all.sort()).toEqual(Object.keys(SETTINGS_DEFAULTS).sort());
    for (const [name, keys] of Object.entries(SECTIONS)) {
      const part = Object.fromEntries(keys.map((k) => [k, SETTINGS_DEFAULTS[k as keyof typeof SETTINGS_DEFAULTS]]));
      expect(SECTION_SCHEMAS[name as keyof typeof SECTION_SCHEMAS].safeParse(part).success).toBe(true);
    }
  });

  it("rejects out-of-range and unknown values", () => {
    expect(bad({ extractor_timeout_ms: 999 })).toBe(false);
    expect(bad({ extractor_timeout_ms: 10001 })).toBe(false);
    expect(bad({ risk_threshold: 0 })).toBe(false);
    expect(bad({ risk_threshold: 101 })).toBe(false);
    expect(bad({ risk_half_life_min: 0 })).toBe(false);
    expect(bad({ risk_half_life_min: 1441 })).toBe(false);
    expect(bad({ gauntlet_concurrency: 0 })).toBe(false);
    expect(bad({ gauntlet_concurrency: 11 })).toBe(false);
    expect(bad({ dispute_poll_seconds: 29 })).toBe(false);
    expect(bad({ dispute_poll_seconds: 3601 })).toBe(false);
    expect(bad({ extractor_model: "gpt-4" })).toBe(false);
    expect(bad({ agent_prompt: "loose" })).toBe(false);
    expect(bad({ zapier_hook_url: "https://example.com/hook" })).toBe(false);
    expect(bad({ zapier_hook_url: "https://hooks.zapier.com/hooks/catch/1/2" })).toBe(true);
  });
});

describe("settingsFromEnv", () => {
  it("falls back to defaults for absent keys", () => {
    expect(settingsFromEnv({})).toEqual(SETTINGS_DEFAULTS);
    expect(settingsFromEnv({ ZAPIER_HOOK_URL: "  " })).toEqual(SETTINGS_DEFAULTS);
  });

  it("maps env strings to typed values", () => {
    expect(
      settingsFromEnv({
        EXTRACTOR_MODEL: "claude-opus-5-5",
        EXTRACTOR_TIMEOUT_MS: "2500",
        RISK_THRESHOLD: "80",
        RISK_HALF_LIFE_MIN: "45",
        DEMO_AGENT_MODEL: "claude-sonnet-5-5",
        DEMO_AGENT_PROMPT: "strict",
        GAUNTLET_CUSTOMER_MODEL: "claude-sonnet-5-5",
        GAUNTLET_CONCURRENCY: "3",
        DISPUTE_AUTO_SUBMIT: "true",
        DISPUTE_POLL_SECONDS: "60",
        ZAPIER_HOOK_URL: "https://hooks.zapier.com/hooks/catch/1/2",
      }),
    ).toEqual({
      extractor_model: "claude-opus-5-5",
      extractor_timeout_ms: 2500,
      risk_threshold: 80,
      risk_half_life_min: 45,
      agent_model: "claude-sonnet-5-5",
      agent_prompt: "strict",
      gauntlet_customer_model: "claude-sonnet-5-5",
      gauntlet_concurrency: 3,
      dispute_auto_submit: true,
      dispute_poll_seconds: 60,
      zapier_hook_url: "https://hooks.zapier.com/hooks/catch/1/2",
    });
  });

  it("throws on invalid env", () => {
    for (const env of [
      { EXTRACTOR_MODEL: "nope" },
      { EXTRACTOR_TIMEOUT_MS: "5" },
      { EXTRACTOR_TIMEOUT_MS: "abc" },
      { RISK_THRESHOLD: "500" },
      { GAUNTLET_CONCURRENCY: "99" },
      { DISPUTE_POLL_SECONDS: "1" },
      { ZAPIER_HOOK_URL: "https://evil.example/x" },
    ]) {
      expect(() => settingsFromEnv(env)).toThrow();
    }
  });
});
