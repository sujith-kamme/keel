import { readTimestampReply, timestampRequest } from "@keel/engine";

// Phase 8b: a public timestamp authority signs the ledger head every few minutes, so the
// chain can't be rewritten after the fact without the signed hash no longer matching.
// Only the 32-byte hash leaves Keel. A failure just waits for the next tick.

export const TSA_URL = "https://freetsa.org/tsr";

const TSA_TIMEOUT_MS = 15_000;

export interface AnchorDeps {
  head: () => Promise<{ seq: number; hash: string } | null>;
  latest: () => Promise<{ seq: number } | null>;
  save: (a: { seq: number; hash: string; tsa: string; token: Uint8Array; signed_at: Date }) => Promise<void>;
  fetch: typeof fetch;
}

/** Timestamps the head when it moved since the last anchor; returns the anchored seq, or null. */
export async function anchorLedger(deps: AnchorDeps): Promise<number | null> {
  const [head, latest] = await Promise.all([deps.head(), deps.latest()]);
  if (!head || (latest && latest.seq >= head.seq)) return null;
  try {
    const res = await deps.fetch(TSA_URL, {
      method: "POST",
      headers: { "content-type": "application/timestamp-query" },
      body: timestampRequest(head.hash),
      signal: AbortSignal.timeout(TSA_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`TSA answered ${res.status}`);
    const token = new Uint8Array(await res.arrayBuffer());
    const reply = readTimestampReply(token, head.hash);
    if (!reply) throw new Error("TSA reply refused or for another hash");
    await deps.save({ seq: head.seq, hash: head.hash, tsa: TSA_URL, token, signed_at: reply.signed_at });
    return head.seq;
  } catch (e) {
    console.warn("ledger anchor skipped:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}
