import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TSA_URL, anchorLedger } from "./anchor";

const HASH = "d6dba7e8a54d32d2cf8eef5b0e648c5c388079827039a1e56a9bfb282fc883ab";
const reply = readFileSync(new URL("../../../../packages/engine/src/fixtures/freetsa-keel.tsr", import.meta.url));

function deps(over: { head?: { seq: number; hash: string } | null; latest?: { seq: number } | null; fetch?: typeof fetch } = {}) {
  return {
    head: async () => (over.head === undefined ? { seq: 42, hash: HASH } : over.head),
    latest: async () => over.latest ?? null,
    save: vi.fn(async () => {}),
    fetch: over.fetch ?? vi.fn(async () => new Response(reply)),
  };
}

describe("anchorLedger", () => {
  it("timestamps a moved head and stores the signed reply", async () => {
    const d = deps({ latest: { seq: 40 } });
    expect(await anchorLedger(d)).toBe(42);
    expect(d.fetch).toHaveBeenCalledWith(TSA_URL, expect.objectContaining({ method: "POST" }));
    expect(d.save).toHaveBeenCalledWith({ seq: 42, hash: HASH, tsa: TSA_URL, token: new Uint8Array(reply), signed_at: new Date("2026-11-06T21:53:46Z") });
  });

  it("sends nothing when the head hasn't moved or the ledger is empty", async () => {
    for (const d of [deps({ latest: { seq: 42 } }), deps({ head: null })]) {
      expect(await anchorLedger(d)).toBeNull();
      expect(d.fetch).not.toHaveBeenCalled();
    }
  });

  it("stores nothing and doesn't throw when the TSA fails or answers for another hash", async () => {
    const failing = [
      vi.fn(async () => { throw new Error("network down"); }),
      vi.fn(async () => new Response("busy", { status: 503 })),
      vi.fn(async () => new Response(reply)),
      vi.fn(async () => new Response(new Uint8Array(65 * 1024))),
    ];
    const heads = [undefined, undefined, { seq: 42, hash: "00".repeat(32) }, undefined];
    for (const [i, f] of failing.entries()) {
      const d = deps({ fetch: f as unknown as typeof fetch, head: heads[i] });
      expect(await anchorLedger(d)).toBeNull();
      expect(d.save).not.toHaveBeenCalled();
    }
  });
});
