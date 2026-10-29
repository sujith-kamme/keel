import { decision, toolLabel, usd } from "./overview-view";
import { reasonLabel } from "./reason-labels";

export interface LedgerRow {
  seq: number;
  decision_id: string;
  created_at: string;
  session_id: string | null;
  order_id: string | null;
  capture_id: string | null;
  dispute_id: string | null;
  mode: string;
  verdict: string;
  reason_codes: string[];
  tool: string | null;
  amount: string | null;
  hash: string;
  prev_hash: string | null;
  payload: unknown;
}

export interface LedgerPage {
  rows: LedgerRow[];
  next_before_seq: number | null;
  /** Entries in the whole ledger. */
  total: number;
}

type Neighbour = { seq: number; hash: string } | null;

/** GET /v1/ledger/:seq: one entry, its neighbours, and a check of its own hash and link. */
export interface LedgerEntry {
  entry: LedgerRow;
  prev: Neighbour;
  next: Neighbour;
  hash_ok: boolean;
  link_ok: boolean;
}

export type ChainResult = { ok: true; count: number } | { ok: false; count: number; broken_at_seq: number; problem: string };

export const isBeforeSeq = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

export const chainMessage = (r: ChainResult) =>
  r.ok ? `Chain intact: ${r.count.toLocaleString("en-US")} entries` : `Broken at seq ${r.broken_at_seq}: ${r.problem}`;

/** Amount as a number for the grid's number filter; null when absent or not numeric. */
export const amountValue = (amount: string | null) => (amount !== null && /^\d+(\.\d+)?$/.test(amount) ? Number(amount) : null);

/** "a41f…09c2". */
export const shortHash = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;

const STAMP = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** "Oct 28, 09:38:44" in UTC; an em dash for anything unparseable. */
export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : STAMP.format(d);
}

export type Range = "1h" | "24h" | "7d" | "all";
const RANGE_MS: Record<Range, number> = { "1h": 3600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, all: Number.POSITIVE_INFINITY };

/** Whether a row falls in the range, counting back from `now`. */
export const inRange = (createdAt: string, range: Range, now: Date) => now.getTime() - new Date(createdAt).getTime() <= RANGE_MS[range];

/** The hash banner on an entry page. */
export function hashCheck(e: Pick<LedgerEntry, "prev" | "hash_ok" | "link_ok">): { ok: boolean; title: string; detail: string } {
  if (e.hash_ok && e.link_ok) {
    const link = e.prev ? `links to entry ${e.prev.seq}` : "is the first entry in the chain";
    return { ok: true, title: "Hash verified", detail: `This entry's hash matches its content and ${link}.` };
  }
  const problems = [
    !e.hash_ok && "this entry's hash doesn't match its content",
    !e.link_ok && (e.prev ? `its previous hash doesn't match entry ${e.prev.seq}` : "it should be the first entry but points at a previous hash"),
  ].filter(Boolean);
  const text = problems.join(", and ");
  return { ok: false, title: "Hash mismatch", detail: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

const VERBS: Record<string, string> = { ALLOW: "allowed", BLOCK: "blocked", HOLD: "held", REWRITE: "rewrote" };
// On a dispute row the verdict is about the money the buyer asks for.
const DISPUTE_VERBS: Record<string, string> = { ALLOW: "concede", BLOCK: "defend", HOLD: "leave for review" };

/** One plain sentence from the entry's own fields: tool, verdict, reasons, amount and order. Nothing else is inferred. */
export function entrySentence(r: Pick<LedgerRow, "tool" | "verdict" | "reason_codes" | "amount" | "order_id" | "dispute_id">): string {
  const reasons = r.reason_codes.filter((c) => c !== "OK").map((c) => reasonLabel(c).toLowerCase());
  const why = reasons.length > 0 ? `: ${reasons.join(", ")}` : "";
  const amount = r.amount !== null && usd(r.amount) !== "—" ? ` of ${usd(r.amount)}` : "";
  if (r.tool === "dispute" && r.dispute_id) {
    return `Keel classified dispute ${r.dispute_id}${amount} as one to ${DISPUTE_VERBS[r.verdict] ?? r.verdict}${why}.`;
  }
  const what = `${r.tool ? toolLabel(r.tool) : "Ledger entry"}${amount}${r.order_id ? ` on order ${r.order_id}` : ""}${r.dispute_id ? ` on dispute ${r.dispute_id}` : ""}`;
  return `${what}. Keel ${VERBS[r.verdict] ?? r.verdict} it${why}.`;
}

/** "refund blocked"; a dispute row reads as what Keel chose, "dispute classified: defend". */
export function entryTitle(r: Pick<LedgerRow, "tool" | "verdict">): string {
  if (r.tool === "dispute") return `dispute classified: ${({ ALLOW: "concede", BLOCK: "defend", HOLD: "review" } as Record<string, string>)[r.verdict] ?? r.verdict}`;
  return `${r.tool ? toolLabel(r.tool) : "Ledger entry"} ${decision(r.verdict).label}`.toLowerCase();
}
