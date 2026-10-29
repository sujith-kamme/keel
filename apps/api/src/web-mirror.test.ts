import { HOOK_PREFIX } from "@keel/worker/notify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REVIEW_LIMIT } from "../../web/lib/review-view";
import { HOOK_PREFIX as WEB_HOOK_PREFIX, SECTION_SCHEMAS as WEB_SCHEMAS } from "../../web/lib/settings-view";
import { LIMIT } from "./routes/review";
import { SECTION_SCHEMAS } from "./settings-schema";

// The console keeps copies of these (it can't import the API's modules); this fails when they drift.
describe("console mirrors of API constants", () => {
  it("settings sections accept the same values", () => {
    expect(Object.keys(WEB_SCHEMAS).sort()).toEqual(Object.keys(SECTION_SCHEMAS).sort());
    for (const s of ["guard", "agent", "gauntlet", "disputes"] as const) {
      expect(z.toJSONSchema(WEB_SCHEMAS[s]), s).toEqual(z.toJSONSchema(SECTION_SCHEMAS[s]));
    }
    expect(WEB_HOOK_PREFIX).toBe(HOOK_PREFIX);
  });

  it("the review queue cap", () => {
    expect(REVIEW_LIMIT).toBe(LIMIT);
  });
});
