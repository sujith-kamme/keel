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
}

export type ChainResult = { ok: true; count: number } | { ok: false; count: number; broken_at_seq: number; problem: string };

export const VERDICT_STYLE: Record<string, string> = {
  ALLOW: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  BLOCK: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  REWRITE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  HOLD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

export const isBeforeSeq = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

export const chainMessage = (r: ChainResult) =>
  r.ok ? `Chain intact: ${r.count.toLocaleString("en-US")} entries` : `Broken at seq ${r.broken_at_seq}: ${r.problem}`;

/** Amount as a number for the grid's number filter; null when absent or not numeric. */
export const amountValue = (amount: string | null) => (amount !== null && /^\d+(\.\d+)?$/.test(amount) ? Number(amount) : null);
