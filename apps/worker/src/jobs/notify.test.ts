import { describe, expect, it, vi } from "vitest";
import { type NotifyEvent, notifyConfig, sendNotify } from "./notify";

const HOOK = "https://hooks.zapier.com/hooks/catch/1/abc/";
const event: NotifyEvent = {
  event: "session.quarantined",
  session_id: "ses_1",
  decision_id: "dec_1",
  reason_codes: ["VELOCITY"],
  score: 80,
  console_url: "https://keel.example/s/ses_1",
  at: "2026-01-01T00:00:00.000Z",
};
const okFetch = () => vi.fn(async () => new Response("ok", { status: 200 }));

describe("sendNotify", () => {
  it("POSTs the exact event as json to the hook", async () => {
    const fetch = okFetch();
    expect(await sendNotify(event, { hookUrl: HOOK, fetch })).toEqual({ status: 200 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(HOOK);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toEqual(event);
  });

  it("drops extra keys", async () => {
    const fetch = okFetch();
    await sendNotify({ ...event, transcript: "secret", email: "a@b.c" } as NotifyEvent, { hookUrl: HOOK, fetch });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(body).sort()).toEqual(Object.keys(event).sort());
  });

  it("sends a dispute event with only its known keys", async () => {
    const fetch = okFetch();
    const dispute = { event: "dispute.classified" as const, dispute_id: "PP-D-1", decision_id: "dec_2", reason_codes: ["DISPUTE_WITHIN_POLICY"], console_url: "https://keel.example/disputes/PP-D-1", at: "2026-01-01T00:00:00.000Z" };
    await sendNotify({ ...dispute, buyer_text: "secret" } as NotifyEvent, { hookUrl: HOOK, fetch });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual(dispute);
  });

  it("omits score when undefined", async () => {
    const fetch = okFetch();
    await sendNotify({ ...event, score: undefined }, { hookUrl: HOOK, fetch });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect("score" in body).toBe(false);
  });

  it("skips when no hook is configured", async () => {
    const fetch = okFetch();
    expect(await sendNotify(event, { hookUrl: null, fetch })).toEqual({ skipped: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws on non-2xx without leaking the url", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 500 }));
    const err = await sendNotify(event, { hookUrl: HOOK, fetch }).catch((e: Error) => e);
    expect((err as Error).message).toBe("zapier responded 500");
  });
});

describe("notifyConfig", () => {
  it("returns null for unset or blank", () => {
    expect(notifyConfig({})).toEqual({ hookUrl: null });
    expect(notifyConfig({ ZAPIER_HOOK_URL: "  " })).toEqual({ hookUrl: null });
  });
  it("accepts a zapier https url", () => {
    expect(notifyConfig({ ZAPIER_HOOK_URL: HOOK })).toEqual({ hookUrl: HOOK });
  });
  it("rejects other hosts and non-https", () => {
    expect(() => notifyConfig({ ZAPIER_HOOK_URL: "https://evil.example.com/x" })).toThrow();
    expect(() => notifyConfig({ ZAPIER_HOOK_URL: "http://hooks.zapier.com/" })).toThrow();
  });
});
