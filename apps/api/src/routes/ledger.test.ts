import { type LedgerContent, chainEntry } from "@keel/engine";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type LedgerOptions, type LedgerPageRow, mountLedger } from "./ledger";

const operatorKey = "o".repeat(32);
const merchantKey = "m".repeat(32);
const auth = (key: string) => ({ authorization: `Bearer ${key}` });
const AT = new Date("2026-10-28T12:00:00Z");

const content = (i: number, payload: unknown = { tool: "offer_refund", args: { amount: "12.50" } }): LedgerContent => ({
  decision_id: `dec_${i}`,
  session_id: "ses_1",
  order_id: "O-1",
  capture_id: null,
  dispute_id: null,
  mode: "LIVE",
  verdict: "ALLOW",
  reason_codes: ["OK"],
  payload,
});

/** A valid chain of n entries, seq 1..n. */
function chain(n: number) {
  const out: { seq: number; record: ReturnType<typeof chainEntry> }[] = [];
  for (let i = 1; i <= n; i++) out.push({ seq: i, record: chainEntry(content(i), out.at(-1)?.record.hash ?? null) });
  return out;
}

const rows = (n: number): LedgerPageRow[] => chain(n).map(({ seq, record }) => ({ ...record, seq, created_at: AT })).reverse();

function setup(over: Partial<LedgerOptions> = {}) {
  const all = rows(5);
  const page = vi.fn<LedgerOptions["page"]>(async ({ beforeSeq, limit }) =>
    all.filter((r) => beforeSeq === undefined || r.seq < beforeSeq).slice(0, limit),
  );
  const app = new Hono();
  mountLedger(app, { operatorKey, merchantKey, page, chain: async () => chain(5), ...over });
  return { app, page };
}

describe("ledger routes", () => {
  it("needs the operator key", async () => {
    const { app } = setup();
    for (const path of ["/v1/ledger", "/v1/ledger/verify", "/v1/ledger/export.json"]) {
      expect((await app.request(path)).status).toBe(401);
      expect((await app.request(path, { headers: auth(merchantKey) })).status).toBe(403);
    }
  });

  it("pages newest first and says where the next page starts", async () => {
    const { app, page } = setup();
    const res = await app.request("/v1/ledger?limit=2", { headers: auth(operatorKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { seq: number }[]; next_before_seq: number | null };
    expect(body.rows.map((r) => r.seq)).toEqual([5, 4]);
    expect(body.next_before_seq).toBe(4);
    expect(page).toHaveBeenCalledWith({ beforeSeq: undefined, limit: 2 });

    const older = (await (await app.request("/v1/ledger?before_seq=4&limit=3", { headers: auth(operatorKey) })).json()) as typeof body;
    expect(older.rows.map((r) => r.seq)).toEqual([3, 2, 1]);
    expect(older.next_before_seq).toBe(1);

    const last = (await (await app.request("/v1/ledger?before_seq=2", { headers: auth(operatorKey) })).json()) as typeof body;
    expect(last.rows.map((r) => r.seq)).toEqual([1]);
    expect(last.next_before_seq).toBeNull();
    expect(page).toHaveBeenLastCalledWith({ beforeSeq: 2, limit: 500 });
  });

  it("returns the grid row shape with tool and amount from the payload", async () => {
    const one = (payload: unknown): LedgerPageRow => ({ ...chainEntry(content(1, payload), null), seq: 1, created_at: AT });
    const cases: [unknown, string | null, string | null][] = [
      [{ tool: "offer_refund", args: { amount: "12.50" } }, "offer_refund", "12.50"],
      [{ tool: "dispute", amount: { value: "30.00", currency_code: "USD" } }, "dispute", "30.00"],
      [{ tool: 7, args: { amount: 5 } }, null, null],
      ["not an object", null, null],
    ];
    for (const [payload, tool, amount] of cases) {
      const { app } = setup({ page: async () => [one(payload)] });
      const body = (await (await app.request("/v1/ledger", { headers: auth(operatorKey) })).json()) as { rows: Record<string, unknown>[] };
      expect(body.rows[0]).toMatchObject({ seq: 1, created_at: AT.toISOString(), tool, amount, payload, verdict: "ALLOW", reason_codes: ["OK"] });
      expect(Object.keys(body.rows[0]!)).toEqual(
        expect.arrayContaining(["decision_id", "session_id", "order_id", "capture_id", "dispute_id", "mode", "hash", "prev_hash"]),
      );
    }
  });

  it("rejects bad paging params", async () => {
    const { app, page } = setup();
    for (const q of ["limit=0", "limit=2001", "limit=abc", "limit=1.5", "before_seq=0", "before_seq=-1", "before_seq=x", "other=1"]) {
      const res = await app.request(`/v1/ledger?${q}`, { headers: auth(operatorKey) });
      expect(res.status, q).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(page).not.toHaveBeenCalled();
  });

  it("verifies an intact chain", async () => {
    const { app } = setup();
    const res = await app.request("/v1/ledger/verify", { headers: auth(operatorKey) });
    expect(await res.json()).toEqual({ ok: true, count: 5 });
  });

  it("reports the seq of a tampered row", async () => {
    const tampered = chain(5).map((r) => ({ ...r, seq: r.seq + 100 }));
    tampered[2] = { ...tampered[2]!, record: { ...tampered[2]!.record, verdict: "BLOCK" } };
    const { app } = setup({ chain: async () => tampered });
    const res = await app.request("/v1/ledger/verify", { headers: auth(operatorKey) });
    expect(await res.json()).toEqual({ ok: false, count: 5, broken_at_seq: 103, problem: "HASH_MISMATCH" });

    const relinked = chain(3);
    relinked[1] = { ...relinked[1]!, record: { ...relinked[1]!.record, prev_hash: "f".repeat(64) } };
    const { app: app2 } = setup({ chain: async () => relinked });
    const res2 = await app2.request("/v1/ledger/verify", { headers: auth(operatorKey) });
    expect(await res2.json()).toEqual({ ok: false, count: 3, broken_at_seq: 2, problem: "BROKEN_LINK" });
  });

  it("exports all rows newest first as a JSON attachment", async () => {
    const { app } = setup();
    const res = await app.request("/v1/ledger/export.json", { headers: auth(operatorKey) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="keel-ledger.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { seq: number; payload: unknown }[];
    expect(body.map((r) => r.seq)).toEqual([5, 4, 3, 2, 1]);
    expect(body[0]!.payload).toEqual({ tool: "offer_refund", args: { amount: "12.50" } });
  });

  it("caps the export at 10,000 rows, paging by seq", async () => {
    const page = vi.fn<LedgerOptions["page"]>(async ({ beforeSeq = 20_001, limit }) =>
      Array.from({ length: limit }, (_, i) => ({ ...rows(1)[0]!, seq: beforeSeq - 1 - i })),
    );
    const { app } = setup({ page });
    const body = (await (await app.request("/v1/ledger/export.json", { headers: auth(operatorKey) })).json()) as { seq: number }[];
    expect(body).toHaveLength(10_000);
    expect(body.at(-1)!.seq).toBe(10_001);
    expect(page).toHaveBeenCalledTimes(5);
  });
});
