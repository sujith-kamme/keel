import { randomUUID } from "node:crypto";
import { type Db, type SettingChanges, readSettings, seedSettings, writeSettings } from "@keel/db";
import { SECTION_SCHEMAS, type Section, SETTINGS_DEFAULTS, type Settings, settingsFromEnv, settingsSchema } from "./settings-schema";

const KEYS = Object.keys(SETTINGS_DEFAULTS);
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

export interface SettingsService {
  init(): Promise<void>;
  get(): Promise<Settings>;
  update(section: Section, patch: unknown, operator: string): Promise<{ changes: SettingChanges }>;
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
  // Bumped by update so a get() that was reading across it cannot re-cache the old value.
  let generation = 0;

  return {
    /** Env values are first-boot defaults: only keys with no row yet are inserted. */
    init: () => seedSettings(db, settingsFromEnv(env)),
    get: async () => {
      if (cache && now() - cache.at < ttlMs) return cache.value;
      const started = generation;
      const value = settingsSchema.parse(await readSettings(db, KEYS));
      if (started === generation) cache = { value, at: now() };
      return value;
    },
    update: async (section, patch, operator) => {
      const parsed: Record<string, unknown> = SECTION_SCHEMAS[section].partial().parse(patch);
      const values = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined));
      let redacted: SettingChanges = {};
      try {
        await writeSettings(db, values, operator, (changes) => {
          redacted = Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, redact(k, c.from, c.to)]));
          return {
            decision_id: newId("dec"),
            session_id: null,
            order_id: null,
            capture_id: null,
            dispute_id: null,
            mode: "LIVE",
            verdict: "ALLOW",
            reason_codes: ["OK"],
            payload: { tool: "settings_update", section, changes: redacted, operator },
          };
        });
      } catch {
        // A driver error can carry the bound parameters, which may be the Zapier URL: surface none of it.
        throw new Error("settings write failed");
      } finally {
        generation++;
        cache = null;
      }
      return { changes: redacted };
    },
  };
}
