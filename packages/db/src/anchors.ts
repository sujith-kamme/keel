import { asc, desc, gte } from "drizzle-orm";
import type { Db } from "./client";
import { ledgerAnchors, ledgerEntries } from "./schema";

export interface Anchor {
  seq: number;
  hash: string;
  tsa: string;
  token: Uint8Array;
  signed_at: Date;
}

const cols = { seq: ledgerAnchors.seq, hash: ledgerAnchors.hash, tsa: ledgerAnchors.tsa, token: ledgerAnchors.token, signed_at: ledgerAnchors.signedAt };

/** The newest ledger row's seq and hash, or null for an empty ledger. */
export async function ledgerHead(db: Db): Promise<{ seq: number; hash: string } | null> {
  const [row] = await db.select({ seq: ledgerEntries.seq, hash: ledgerEntries.hash }).from(ledgerEntries).orderBy(desc(ledgerEntries.seq)).limit(1);
  return row ?? null;
}

export async function insertAnchor(db: Db, a: Anchor): Promise<void> {
  await db.insert(ledgerAnchors).values({ seq: a.seq, hash: a.hash, tsa: a.tsa, token: a.token, signedAt: a.signed_at });
}

export async function latestAnchor(db: Db): Promise<Anchor | null> {
  const [row] = await db.select(cols).from(ledgerAnchors).orderBy(desc(ledgerAnchors.seq)).limit(1);
  return row ?? null;
}

/** The earliest anchor at or after `seq`: the tightest signed time that row existed by. */
export async function anchorCovering(db: Db, seq: number): Promise<Anchor | null> {
  const [row] = await db.select(cols).from(ledgerAnchors).where(gte(ledgerAnchors.seq, seq)).orderBy(asc(ledgerAnchors.seq)).limit(1);
  return row ?? null;
}
