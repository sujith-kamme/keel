import { randomUUID } from "node:crypto";
import { createDb } from "@keel/db";
import type { PayPalClient } from "@keel/paypal";
import { describe, expect, it } from "vitest";
import type { RiskService } from "../risk";
import { createGatewayDeps } from "./deps";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.DATABASE_URL)("withOrderLock (Postgres)", () => {
  const deps = createGatewayDeps(createDb(), {} as PayPalClient, {} as RiskService, async () => {});

  async function overlap(a: [string, string], b: [string, string]) {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = deps.withOrderLock(a[0], a[1], async () => {
      events.push("a:start");
      await gate;
      events.push("a:end");
    });
    await wait(150);
    const second = deps.withOrderLock(b[0], b[1], async () => void events.push("b"));
    await wait(300);
    release();
    await Promise.all([first, second]);
    return events;
  }

  it("serializes refunds on different orders of the same session", async () => {
    const s = `ses_${randomUUID()}`;
    expect(await overlap([s, `O-${randomUUID()}`], [s, `O-${randomUUID()}`])).toEqual(["a:start", "a:end", "b"]);
  });

  it("lets different sessions and orders run concurrently", async () => {
    expect(await overlap([`ses_${randomUUID()}`, `O-${randomUUID()}`], [`ses_${randomUUID()}`, `O-${randomUUID()}`])).toEqual([
      "a:start",
      "b",
      "a:end",
    ]);
  });
});
