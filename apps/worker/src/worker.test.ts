import { afterEach, describe, expect, it, vi } from "vitest";
import { processor } from "./worker";

const HOOK = "https://hooks.zapier.com/hooks/catch/1/abc/";
const job = {
  name: "notify",
  data: { event: "action.held", session_id: "ses_1", decision_id: "dec_1", reason_codes: ["OK"], console_url: "https://c.test", at: "2026-10-28T00:00:00Z" },
};

describe("worker processor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the hook URL per notify job", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    let hook: string | null = null;
    const run = processor({ hookUrl: async () => hook });
    expect(await run(job)).toEqual({ skipped: true });
    hook = HOOK;
    expect(await run(job)).toEqual({ status: 200 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![0]).toBe(HOOK);
  });
});
