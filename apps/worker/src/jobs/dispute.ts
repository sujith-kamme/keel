import { createHash } from "node:crypto";
import { type DisputeClassification, type ReasonCode, type RefundAttempt, type Verdict, classifyDispute } from "@keel/core";
import { type Dispute, type DisputeSummary, type EvidenceSubmission, hasAction, pickEvidenceType } from "@keel/paypal/disputes";
import { type PackInput, type PackRow, buildPack } from "../evidence/pack";
import { renderPdf } from "../evidence/pdf";

// FSD §10.1: a dispute arrives (webhook or poll) → match the ledger → classify →
// submit evidence, accept the claim, or wait for an operator. PayPal only allows
// an action once it offers the link for it, so every sync re-checks.

export type DisputeAction = "WAITING_ON_PAYPAL" | "SUBMITTING" | "EVIDENCE_SUBMITTED" | "CLAIM_ACCEPTED" | "AWAITING_OPERATOR" | "FAILED";
export type DisputeOutcome = "OPEN" | "WON" | "LOST" | "CONCEDED";

export interface DisputeRow {
  id: string;
  capture_id: string | null;
  classification: DisputeClassification | null;
  action: DisputeAction | null;
  outcome: DisputeOutcome;
  decision_id: string | null;
  evidence_type: string | null;
  evidence_notes: string | null;
  evidence_pdf: Uint8Array | null;
}

export interface LedgerRow {
  seq: number;
  decision_id: string;
  session_id: string | null;
  order_id: string | null;
  verdict: string;
  reason_codes: string[];
  payload: Record<string, unknown>;
  prev_hash: string | null;
  hash: string;
  created_at: string;
}

export interface DisputeContext {
  order: NonNullable<PackInput["order"]> | null;
  /** Ledger rows for the order or capture and every live session that discussed the order, in ledger order. */
  rows: LedgerRow[];
  turns: PackInput["turns"];
  policies: PackInput["policies"];
}

export interface Classified {
  classification: DisputeClassification;
  reason_codes: ReasonCode[];
  injection: "none" | "flagged" | "scan_failed";
  decision_id: string;
  order_id: string | null;
  evidence_type: string | null;
  evidence_notes: string | null;
  evidence_pdf: Uint8Array | null;
  evidence_sha256: string | null;
}

export interface DisputeStore {
  /** Inserts or refreshes PayPal's view of the dispute and returns Keel's row. */
  upsert: (d: Dispute, outcome: DisputeOutcome, now: Date) => Promise<DisputeRow>;
  context: (captureId: string) => Promise<DisputeContext>;
  /** Appends the ledger row and records the classification, only if it isn't classified yet. False when another sync won. */
  classify: (id: string, c: Classified, ledger: LedgerEntry, now: Date) => Promise<boolean>;
  /** Moves `action` from one of `from` to `to`; false when it wasn't in `from`. */
  setAction: (id: string, from: (DisputeAction | null)[], to: DisputeAction, error: string | null, now: Date) => Promise<boolean>;
  /** Disputes Keel still has to watch (not resolved). */
  openIds: () => Promise<string[]>;
}

export interface LedgerEntry {
  decision_id: string;
  session_id: string | null;
  order_id: string | null;
  capture_id: string | null;
  dispute_id: string;
  mode: "LIVE";
  verdict: Verdict;
  reason_codes: ReasonCode[];
  payload: Record<string, unknown>;
}

export interface DisputePayPal {
  get: (id: string) => Promise<Dispute>;
  list: (updatedAfter: string) => Promise<DisputeSummary[]>;
  /** Refunds PayPal has recorded on the order's captures. */
  refunds: (orderId: string) => Promise<{ id: string; status: string; amount: string }[]>;
  capture: (captureId: string) => Promise<{ id: string; status: string; amount: string } | null>;
  provideEvidence: (id: string, e: EvidenceSubmission, requestId: string) => Promise<unknown>;
  acceptClaim: (id: string, note: string, requestId: string) => Promise<unknown>;
}

export interface DisputeNotice {
  event: "dispute.classified";
  dispute_id: string;
  decision_id: string;
  reason_codes: string[];
  console_url: string;
  at: string;
}

export interface DisputeDeps {
  store: DisputeStore;
  paypal: DisputePayPal;
  /** True when the buyer's text carries an injection attempt. Throws when the scan can't run. */
  scan: (buyerText: string) => Promise<boolean>;
  notify: (e: DisputeNotice) => Promise<void>;
  enqueueSync: (id: string) => Promise<void>;
  autoSubmit: boolean;
  consoleUrl: string;
  newId: (prefix: string) => string;
  now: () => Date;
}

// Keel's verdict is about the money the buyer asks for.
const VERDICT: Record<DisputeClassification, Verdict> = { CONCEDE: "ALLOW", DEFEND: "BLOCK", REVIEW: "HOLD" };

const PAID = new Set(["COMPLETED", "PENDING"]);

/** PayPal's outcome codes → Keel's outcome. Anything unresolved stays OPEN. */
export function outcomeOf(d: Dispute): DisputeOutcome {
  if (d.status !== "RESOLVED") return "OPEN";
  const code = d.dispute_outcome?.outcome_code ?? "";
  if (code === "RESOLVED_SELLER_FAVOUR" || code === "CANCELED_BY_BUYER" || code === "DENIED") return "WON";
  if (code === "ACCEPTED") return "CONCEDED";
  return "LOST";
}

function sumCents(values: string[]): string {
  const cents = values.reduce((s, v) => {
    const [w = "0", f = ""] = v.split(".");
    return s + Number(w) * 100 + Number(f.padEnd(2, "0"));
  }, 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** offer_refund rows for the order, with the reviewer's decision for held ones. */
export function refundAttempts(rows: LedgerRow[], currency: string): RefundAttempt[] {
  const reviews = new Map<string, "approved" | "denied">();
  for (const r of rows) {
    const p = r.payload;
    if (p.tool !== "review" || p.resolved !== true || typeof p.ref !== "string") continue;
    if (p.action === "approve") reviews.set(p.ref, "approved");
    if (p.action === "deny") reviews.set(p.ref, "denied");
  }
  return rows
    .filter((r) => r.payload.tool === "offer_refund" && typeof (r.payload.args as { amount?: unknown } | undefined)?.amount === "string")
    .map((r) => ({
      decision_id: r.decision_id,
      amount: { value: (r.payload.args as { amount: string }).amount, currency },
      verdict: r.verdict as Verdict,
      reason_codes: r.reason_codes as ReasonCode[],
      review: reviews.get(r.decision_id) ?? null,
    }));
}

function detail(r: LedgerRow): string {
  const p = r.payload;
  const args = (p.args ?? {}) as Record<string, unknown>;
  if (p.tool === "offer_refund") return `refund ${String(args.amount)} on ${String(args.order_id)}`;
  if (p.tool === "offer_discount") return `discount ${String(args.percent)}%`;
  if (p.tool === "guard") return "agent reply checked";
  if (p.tool === "review") return `reviewer ${String(p.action ?? "")}`.trim();
  return String(p.tool ?? "decision");
}

const packRow = (r: LedgerRow): PackRow => ({
  seq: r.seq, decision_id: r.decision_id, at: r.created_at, tool: String(r.payload.tool ?? ""),
  verdict: r.verdict, reason_codes: r.reason_codes, detail: detail(r), hash: r.hash, prev_hash: r.prev_hash,
});

/** The buyer's own words: dispute messages and notes they submitted. Only ever scanned as data. */
export function buyerText(d: Dispute): string {
  const messages = (d.messages ?? []).filter((m) => m.posted_by === "BUYER").map((m) => m.content);
  const notes = (d.evidences ?? []).filter((e) => e.source === "SUBMITTED_BY_BUYER" && e.notes).map((e) => e.notes as string);
  return [...messages, ...notes].join("\n").slice(0, 4000);
}

async function classify(deps: DisputeDeps, d: Dispute, row: DisputeRow): Promise<void> {
  const captureId = row.capture_id;
  const ctx: DisputeContext = captureId ? await deps.store.context(captureId) : { order: null, rows: [], turns: [], policies: [] };
  let injection: Classified["injection"] = "none";
  const text = buyerText(d);
  if (text) {
    try {
      injection = (await deps.scan(text)) ? "flagged" : "none";
    } catch {
      injection = "scan_failed";
    }
  }
  const order = ctx.order;
  const refunds = order ? await deps.paypal.refunds(order.order_id) : [];
  const capture = order ? await deps.paypal.capture(order.capture_id) : null;
  const amount = { value: d.dispute_amount.value, currency: d.dispute_amount.currency_code };
  const result = classifyDispute({
    reason: d.reason,
    amount,
    captureCurrency: order?.currency ?? null,
    ledgerRows: ctx.rows.length,
    injection,
    refunds: order ? refundAttempts(ctx.rows, order.currency) : [],
    refunded: { value: sumCents(refunds.filter((r) => PAID.has(r.status)).map((r) => r.amount)), currency: amount.currency },
  });

  // The pack is built whenever there's an order, so an operator can submit it for REVIEW too.
  let evidence: Pick<Classified, "evidence_type" | "evidence_notes" | "evidence_pdf" | "evidence_sha256"> = {
    evidence_type: null, evidence_notes: null, evidence_pdf: null, evidence_sha256: null,
  };
  if (order) {
    const pack = buildPack({
      dispute: { id: d.dispute_id, reason: d.reason, amount, created_at: d.create_time ?? deps.now().toISOString() },
      classification: result.classification,
      reason_codes: result.reason_codes,
      order,
      paypal: { capture, refunds },
      turns: ctx.turns,
      rows: ctx.rows.map(packRow),
      policies: ctx.policies,
    });
    const pdf = await renderPdf(pack);
    evidence = {
      evidence_type: pickEvidenceType(d, refunds.some((r) => PAID.has(r.status))),
      evidence_notes: pack.notes,
      evidence_pdf: pdf,
      evidence_sha256: createHash("sha256").update(pdf).digest("hex"),
    };
  }

  const decisionId = deps.newId("dec");
  const sessionId = ctx.rows.find((r) => r.session_id)?.session_id ?? null;
  const classified: Classified = { ...result, injection, decision_id: decisionId, order_id: order?.order_id ?? null, ...evidence };
  const ledger: LedgerEntry = {
    decision_id: decisionId,
    session_id: sessionId,
    order_id: order?.order_id ?? null,
    capture_id: captureId,
    dispute_id: d.dispute_id,
    mode: "LIVE",
    verdict: VERDICT[result.classification],
    reason_codes: result.reason_codes,
    payload: {
      tool: "dispute",
      classification: result.classification,
      dispute_reason: d.reason,
      amount,
      injection,
      matched_rows: ctx.rows.map((r) => r.decision_id),
      evidence_sha256: evidence.evidence_sha256,
    },
  };
  if (!(await deps.store.classify(d.dispute_id, classified, ledger, deps.now()))) return;
  await deps.notify({
    event: "dispute.classified",
    dispute_id: d.dispute_id,
    decision_id: decisionId,
    reason_codes: result.reason_codes,
    console_url: `${deps.consoleUrl}/disputes/${encodeURIComponent(d.dispute_id)}`,
    at: deps.now().toISOString(),
  }).catch(() => undefined); // FR-NTF-2: notifications never block the dispute
}

const shortError = (e: unknown) => {
  const body = (e as { body?: { details?: { issue?: string }[]; name?: string } }).body;
  const issue = body?.details?.[0]?.issue ?? body?.name;
  const status = (e as { status?: number }).status;
  return (issue ? `${status ?? ""} ${issue}` : "PayPal request failed").trim().slice(0, 200);
};

export type ActResult = "DONE" | "NOT_OFFERED" | "BUSY" | "NO_EVIDENCE";

/**
 * Submits the evidence pack or accepts the claim. Used by the sync for auto-submit
 * and by the console for operator decisions. PayPal-Request-Id makes a retried call safe.
 */
export async function act(deps: DisputeDeps, d: Dispute, row: DisputeRow, kind: "evidence" | "accept", from: (DisputeAction | null)[]): Promise<ActResult> {
  const now = deps.now();
  const rel = kind === "evidence" ? "provide_evidence" : "accept_claim";
  if (kind === "evidence" && !(row.evidence_pdf && row.evidence_type && row.evidence_notes)) return "NO_EVIDENCE";
  if (!hasAction(d, rel)) return "NOT_OFFERED";
  if (!(await deps.store.setAction(d.dispute_id, from, "SUBMITTING", null, now))) return "BUSY";
  // One request id per decision and stage: a claim-stage resubmission is a new request.
  const requestId = `${row.decision_id ?? d.dispute_id}-${kind}-${d.dispute_life_cycle_stage ?? "NA"}`;
  try {
    if (kind === "evidence") {
      await deps.paypal.provideEvidence(d.dispute_id, {
        evidence_type: row.evidence_type as string,
        notes: row.evidence_notes as string,
        file: { name: `keel-evidence-${d.dispute_id}.pdf`, bytes: row.evidence_pdf as Uint8Array, type: "application/pdf" },
      }, requestId);
      await deps.store.setAction(d.dispute_id, ["SUBMITTING"], "EVIDENCE_SUBMITTED", null, deps.now());
    } else {
      await deps.paypal.acceptClaim(d.dispute_id, "Keel's ledger shows this refund was owed and not paid; accepting the claim.", requestId);
      await deps.store.setAction(d.dispute_id, ["SUBMITTING"], "CLAIM_ACCEPTED", null, deps.now());
    }
    return "DONE";
  } catch (e) {
    // Never retried automatically: the call may have reached PayPal.
    await deps.store.setAction(d.dispute_id, ["SUBMITTING"], "FAILED", shortError(e), deps.now());
    return "DONE";
  }
}

export async function syncDispute(deps: DisputeDeps, id: string): Promise<void> {
  let d = await deps.paypal.get(id);
  let row = await deps.store.upsert(d, outcomeOf(d), deps.now());
  if (!row.classification) {
    await classify(deps, d, row);
    row = await deps.store.upsert(d, outcomeOf(d), deps.now());
  }
  if (row.outcome !== "OPEN" || !row.classification) return;

  const auto = deps.autoSubmit && row.classification !== "REVIEW";
  if (!auto) {
    if (row.action === null) await deps.store.setAction(id, [null], "AWAITING_OPERATOR", null, deps.now());
    return;
  }
  const kind = row.classification === "DEFEND" ? "evidence" : "accept";
  const waiting = d.status === "WAITING_FOR_SELLER_RESPONSE";
  // After an escalation PayPal asks for evidence again at the claim stage.
  const resubmit = kind === "evidence" && row.action === "EVIDENCE_SUBMITTED" && waiting;
  if (row.action === null || row.action === "WAITING_ON_PAYPAL" || resubmit) {
    const result = await act(deps, d, row, kind, [null, "WAITING_ON_PAYPAL", ...(resubmit ? ["EVIDENCE_SUBMITTED" as const] : [])]);
    if (result === "NOT_OFFERED" && row.action === null) await deps.store.setAction(id, [null], "WAITING_ON_PAYPAL", null, deps.now());
    if (result === "DONE") {
      d = await deps.paypal.get(id);
      await deps.store.upsert(d, outcomeOf(d), deps.now());
    }
  }
}

/** Fallback for missed webhooks. The list lags new disputes, so known open ones are fetched by id. */
export async function pollDisputes(deps: DisputeDeps): Promise<number> {
  const since = new Date(deps.now().getTime() - 7 * 24 * 3600_000).toISOString();
  const ids = new Set([...(await deps.paypal.list(since)).map((s) => s.dispute_id), ...(await deps.store.openIds())]);
  for (const id of ids) await deps.enqueueSync(id);
  return ids.size;
}
