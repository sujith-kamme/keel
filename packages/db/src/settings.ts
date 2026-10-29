import type { LedgerContent } from "@keel/engine";
import { inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { type DbOrTx, appendLedger } from "./ledger";
import { settings } from "./schema";

// Drizzle maps a bare null to SQL NULL; a null setting (e.g. no Zapier hook) must be stored as JSON null.
const json = (v: unknown) => (v === null ? sql`'null'::jsonb` : v);

/** Reads only the named keys, so rows other code keeps in this table never leak in. */
export async function readSettings(db: DbOrTx, keys: string[]): Promise<Record<string, unknown>> {
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Insert keys that have no row yet; existing rows are never touched. */
export async function seedSettings(db: DbOrTx, values: Record<string, unknown>): Promise<void> {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value: json(value) }));
  if (rows.length > 0) await db.insert(settings).values(rows).onConflictDoNothing();
}

export type SettingChanges = Record<string, { from: unknown; to: unknown }>;

/**
 * Under a lock, diff `values` against the stored rows, upsert only the keys that change, and append the
 * ledger row built from those changes, in one transaction. Nothing changes: no write, no ledger row.
 */
export async function writeSettings(
  db: Db,
  values: Record<string, unknown>,
  operator: string,
  buildEntry: (changes: SettingChanges) => LedgerContent,
): Promise<{ changes: SettingChanges }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('keel_settings'))`);
    const current = await readSettings(tx, Object.keys(values));
    const changes: SettingChanges = {};
    for (const [key, to] of Object.entries(values)) {
      if (current[key] !== to) changes[key] = { from: current[key] ?? null, to };
    }
    if (Object.keys(changes).length === 0) return { changes };
    for (const [key, { to }] of Object.entries(changes)) {
      await tx
        .insert(settings)
        .values({ key, value: json(to), updatedBy: operator })
        .onConflictDoUpdate({ target: settings.key, set: { value: json(to), updatedAt: sql`now()`, updatedBy: operator } });
    }
    await appendLedger(tx, buildEntry(changes));
    return { changes };
  });
}
