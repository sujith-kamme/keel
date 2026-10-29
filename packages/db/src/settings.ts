import type { LedgerContent } from "@keel/engine";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { type DbOrTx, appendLedger } from "./ledger";
import { settings } from "./schema";

// Drizzle maps a bare null to SQL NULL; a null setting (e.g. no Zapier hook) must be stored as JSON null.
const json = (v: unknown) => (v === null ? sql`'null'::jsonb` : v);

export async function readSettings(db: DbOrTx): Promise<Record<string, unknown>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Insert keys that have no row yet; existing rows are never touched. */
export async function seedSettings(db: DbOrTx, values: Record<string, unknown>): Promise<void> {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value: json(value) }));
  if (rows.length > 0) await db.insert(settings).values(rows).onConflictDoNothing();
}

/** Upsert the given keys and append the change's ledger row, in one transaction. */
export async function writeSettings(db: Db, values: Record<string, unknown>, operator: string, entry: LedgerContent): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      await tx
        .insert(settings)
        .values({ key, value: json(value), updatedBy: operator })
        .onConflictDoUpdate({ target: settings.key, set: { value: json(value), updatedAt: sql`now()`, updatedBy: operator } });
    }
    await appendLedger(tx, entry);
  });
}
