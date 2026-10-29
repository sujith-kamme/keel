import { createDb, eq, inArray, ledgerEntries, readSettings, settings, sql } from "@keel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSettings } from "./settings";
import { SETTINGS_DEFAULTS } from "./settings-schema";

const HOOK = "https://hooks.zapier.com/hooks/catch/1/secret";

// The service owns the real keys in the shared dev DB, so snapshot the dev DB's rows, run against an empty table, and restore after.
describe.skipIf(!process.env.DATABASE_URL)("settings service (Postgres)", () => {
  const db = createDb();
  let saved: (typeof settings.$inferSelect)[] = [];
  // Only the real keys: other test files keep their own rows in this table.
  const reset = () => db.delete(settings).where(inArray(settings.key, Object.keys(SETTINGS_DEFAULTS)));
  const ledgerFor = async (decisionId: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.decisionId, decisionId));
  const lastSettingsEntry = async () => {
    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(sql`${ledgerEntries.payload}->>'tool' = 'settings_update' and ${ledgerEntries.payload}->>'operator' = 'op@test'`)
      .orderBy(sql`${ledgerEntries.seq} desc`)
      .limit(1);
    return rows[0];
  };
  const settingsEntries = async () =>
    (await db.select({ id: ledgerEntries.decisionId }).from(ledgerEntries).where(sql`${ledgerEntries.payload}->>'tool' = 'settings_update' and ${ledgerEntries.payload}->>'operator' = 'op@test'`)).length;

  beforeAll(async () => {
    saved = await db.select().from(settings).where(inArray(settings.key, Object.keys(SETTINGS_DEFAULTS)));
  });
  afterAll(async () => {
    await reset();
    for (const r of saved) {
      await db.insert(settings).values({ ...r, value: r.value === null ? sql`'null'::jsonb` : r.value });
    }
  });

  it("init seeds from env, and a second init with different env does not overwrite", async () => {
    await reset();
    const first = createSettings(db, { RISK_THRESHOLD: "70", ZAPIER_HOOK_URL: HOOK });
    await first.init();
    expect(await first.get()).toEqual({ ...SETTINGS_DEFAULTS, risk_threshold: 70, zapier_hook_url: HOOK });
    const second = createSettings(db, { RISK_THRESHOLD: "20" });
    await second.init();
    expect((await readSettings(db, Object.keys(SETTINGS_DEFAULTS))).risk_threshold).toBe(70);
    expect((await readSettings(db, Object.keys(SETTINGS_DEFAULTS))).zapier_hook_url).toBe(HOOK);
  });

  it("get serves the cache within the TTL and re-reads after", async () => {
    await reset();
    let t = 1000;
    const s = createSettings(db, {}, { ttlMs: 5000, now: () => t });
    await s.init();
    expect((await s.get()).risk_threshold).toBe(60);
    await db.update(settings).set({ value: 90 }).where(eq(settings.key, "risk_threshold"));
    t += 4999;
    expect((await s.get()).risk_threshold).toBe(60);
    t += 1;
    expect((await s.get()).risk_threshold).toBe(90);
  });

  it("update validates, ledgers only real changes, and busts the cache", async () => {
    await reset();
    const s = createSettings(db, {}, { now: () => 0 });
    await s.init();
    await s.get();
    const before = await settingsEntries();
    const { changes } = await s.update("guard", { risk_threshold: 75, risk_half_life_min: 30 }, "op@test");
    expect(changes).toEqual({ risk_threshold: { from: 60, to: 75 } });
    expect((await s.get()).risk_threshold).toBe(75);
    expect(await settingsEntries()).toBe(before + 1);
    const entry = await lastSettingsEntry();
    expect(entry?.verdict).toBe("ALLOW");
    expect(entry?.reasonCodes).toEqual(["OK"]);
    expect(entry?.payload).toEqual({ tool: "settings_update", section: "guard", changes, operator: "op@test" });
    expect(await ledgerFor(entry?.decisionId ?? "")).toHaveLength(1);
    const [row] = await db.select().from(settings).where(eq(settings.key, "risk_threshold"));
    expect(row?.updatedBy).toBe("op@test");

    await expect(s.update("guard", { risk_threshold: 0 }, "op@test")).rejects.toThrow();
    await expect(s.update("guard", { nope: 1 }, "op@test")).rejects.toThrow();
    await expect(s.update("guard", { agent_model: "claude-opus-5-5" }, "op@test")).rejects.toThrow();
  });

  it("concurrent updates chain from/to instead of both logging the same from", async () => {
    await reset();
    const s = createSettings(db, {});
    await s.init();
    const [a, b] = await Promise.all([
      s.update("guard", { risk_threshold: 75 }, "op@test"),
      s.update("guard", { risk_threshold: 80 }, "op@test"),
    ]);
    const froms = [a, b].map((r) => r.changes.risk_threshold?.from).sort();
    expect(froms).toEqual([60, froms[1]]);
    const final = (await s.get()).risk_threshold;
    expect([75, 80]).toContain(final);
    expect(froms[1]).toBe(final === 75 ? 80 : 75);
  });

  it("a no-op update writes nothing", async () => {
    await reset();
    const s = createSettings(db, {});
    await s.init();
    const before = await settingsEntries();
    const { changes } = await s.update("guard", { risk_threshold: 60 }, "op@test");
    expect(changes).toEqual({});
    expect(await settingsEntries()).toBe(before);
  });

  it("a failed write throws a sanitized error without the URL", async () => {
    const failing = Object.assign(Object.create(db), {
      transaction: () => Promise.reject(new Error(`insert failed, params: ${HOOK}`)),
    });
    const err = await createSettings(failing, {}).update("zapier", { zapier_hook_url: HOOK }, "op@test").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("hooks.zapier.com");
    expect((err as Error).cause).toBeUndefined();
  });

  it("ledgers a zapier change as set / cleared, never the URL", async () => {
    await reset();
    const s = createSettings(db, {});
    await s.init();
    const set = await s.update("zapier", { zapier_hook_url: HOOK }, "op@test");
    expect(set.changes).toEqual({ zapier_hook_url: { from: null, to: "set" } });
    expect((await s.get()).zapier_hook_url).toBe(HOOK);
    const cleared = await s.update("zapier", { zapier_hook_url: null }, "op@test");
    expect(cleared.changes).toEqual({ zapier_hook_url: { from: "set", to: "cleared" } });
    expect((await s.get()).zapier_hook_url).toBeNull();
    expect(JSON.stringify((await lastSettingsEntry())?.payload)).not.toContain("hooks.zapier.com");
    await expect(s.update("zapier", { zapier_hook_url: "https://example.com/x" }, "op@test")).rejects.toThrow();
  });
});
