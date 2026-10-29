import { randomUUID } from "node:crypto";
import { type Db, readSettings, seedSettings, writeSettings } from "@keel/db";
import { SECTION_SCHEMAS, type Section, type Settings, settingsFromEnv, settingsSchema } from "./settings-schema";

const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

export interface SettingsService {
  init(): Promise<void>;
  get(): Promise<Settings>;
  update(section: Section, patch: unknown, operator: string): Promise<{ changes: Record<string, { from: unknown; to: unknown }> }>;
}

/** The zapier hook URL is a secret: the ledger and the caller only ever see "set" / "cleared". */
const redact = (key: string, from: unknown, to: unknown) =>
  key === "zapier_hook_url" ? { from: from === null ? null : "set", to: to === null ? "cleared" : "set" } : { from, to };

export function createSettings(
  db: Db,
  env: Record<string, string | undefined>,
  opts: { ttlMs?: number; now?: () => number } = {},
): SettingsService {
  const ttlMs = opts.ttlMs ?? 5000;
  const now = opts.now ?? Date.now;
  let cache: { value: Settings; at: number } | null = null;

  return {
    /** Env values are first-boot defaults: only keys with no row yet are inserted. */
    init: () => seedSettings(db, settingsFromEnv(env)),
    get: async () => {
      if (cache && now() - cache.at < ttlMs) return cache.value;
      const value = settingsSchema.parse(await readSettings(db));
      cache = { value, at: now() };
      return value;
    },
    update: async (section, patch, operator) => {
      const parsed: Record<string, unknown> = SECTION_SCHEMAS[section].partial().parse(patch);
      const current = settingsSchema.parse(await readSettings(db)) as Record<string, unknown>;
      const values: Record<string, unknown> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, to] of Object.entries(parsed)) {
        if (to === undefined || to === current[key]) continue;
        values[key] = to;
        changes[key] = redact(key, current[key], to);
      }
      if (Object.keys(values).length === 0) return { changes };
      await writeSettings(db, values, operator, {
        decision_id: newId("dec"),
        session_id: null,
        order_id: null,
        capture_id: null,
        dispute_id: null,
        mode: "LIVE",
        verdict: "ALLOW",
        reason_codes: ["OK"],
        payload: { tool: "settings_update", section, changes, operator },
      });
      cache = null;
      return { changes };
    },
  };
}
