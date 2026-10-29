import { describe, expect, it, vi } from "vitest";
import { agentConfigReader } from "./agent-config";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("agentConfigReader", () => {
  it("returns the validated model and prompt", async () => {
    const f = reply(200, { model: "claude-sonnet-5-5", prompt: "strict" });
    const read = agentConfigReader({ url: "http://api", key: "k", fetch: f as unknown as typeof fetch });
    expect(await read()).toEqual({ model: "claude-sonnet-5-5", prompt: "strict" });
    expect(f.mock.calls[0]![0]).toBe("http://api/v1/agent-config");
  });

  it("throws on an invalid model", async () => {
    const read = agentConfigReader({ url: "http://api", key: "k", fetch: reply(200, { model: "gpt-4", prompt: "strict" }) as unknown as typeof fetch });
    await expect(read()).rejects.toThrow(/must be one of/);
  });

  it("throws on a non-2xx response", async () => {
    const read = agentConfigReader({ url: "http://api", key: "k", fetch: reply(503, {}) as unknown as typeof fetch });
    await expect(read()).rejects.toThrow(/503/);
  });

  it("caches for 5 seconds", async () => {
    const f = reply(200, { model: "claude-haiku-5-5", prompt: "lenient" });
    let t = 0;
    const read = agentConfigReader({ url: "http://api", key: "k", fetch: f as unknown as typeof fetch, now: () => t });
    await read();
    t = 4_000;
    await read();
    expect(f).toHaveBeenCalledTimes(1);
    t = 5_001;
    await read();
    expect(f).toHaveBeenCalledTimes(2);
  });
});
