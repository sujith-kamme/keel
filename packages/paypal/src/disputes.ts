import { type PayPalAmount, type PayPalClient, PayPalError, resourceId } from "./index";

// Customer Disputes v1 (FSD §10) and webhook verification (FR-SEC-3).
// Behaviour checked against the sandbox in Phase 6 Task 1: see the Phase 6 plan.

export interface Dispute {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_life_cycle_stage?: string;
  dispute_amount: PayPalAmount;
  disputed_transactions: { seller_transaction_id?: string; buyer_transaction_id?: string }[];
  messages?: { posted_by: string; content: string; time_posted?: string }[];
  evidences?: { evidence_type: string; source?: string; notes?: string }[];
  dispute_outcome?: { outcome_code: string; outcome_reason?: string; amount_refunded?: PayPalAmount };
  links?: { rel: string; href: string; method: string }[];
  create_time?: string;
  update_time?: string;
}

export interface DisputeSummary {
  dispute_id: string;
  update_time?: string;
  status?: string;
}

const path = (id: string, action = "") => `/v1/customer/disputes/${resourceId(id)}${action ? `/${action}` : ""}`;

function sandboxOnly(client: PayPalClient) {
  if (!client.isSandbox) throw new Error("This dispute call is sandbox only");
}

const WEBHOOK_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * Asks PayPal whether a webhook delivery is genuine. False for missing or malformed
 * headers or a body that isn't a JSON object; throws if PayPal's verification call itself fails.
 */
export async function verifyWebhook(
  client: PayPalClient,
  headers: Record<string, string | undefined>,
  rawBody: string,
  webhookId: string,
): Promise<boolean> {
  const fields: Record<string, string> = {};
  for (const [field, header] of Object.entries(WEBHOOK_HEADERS)) {
    const value = headers[header];
    if (!value) return false;
    fields[field] = value;
  }
  // The raw body is embedded as-is (re-serialising could change the signed bytes),
  // so it must be exactly one JSON object or it could smuggle extra fields in.
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  } catch {
    return false;
  }
  const prefix = JSON.stringify({ ...fields, webhook_id: webhookId }).slice(0, -1);
  const body = `${prefix},"webhook_event":${rawBody}}`;
  try {
    const res = await client.send<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", body);
    return res.verification_status === "SUCCESS";
  } catch (e) {
    // PayPal rejecting the headers themselves (400/422) means they weren't PayPal's;
    // anything else (auth, rate limit, outage) is ours to retry.
    if (e instanceof PayPalError && (e.status === 400 || e.status === 422)) return false;
    throw e;
  }
}

export async function getDispute(client: PayPalClient, id: string) {
  return client.request<Dispute>("GET", path(id));
}

/** Note: PayPal's list lags new disputes by minutes; fetch known ids directly. */
export async function listDisputes(client: PayPalClient, updatedAfter: string): Promise<DisputeSummary[]> {
  const query = new URLSearchParams({ update_time_after: updatedAfter, page_size: "50" });
  const res = await client.request<{ items?: DisputeSummary[] }>("GET", `/v1/customer/disputes?${query}`);
  return res.items ?? [];
}

export interface EvidenceSubmission {
  evidence_type: string;
  notes: string;
  file: { name: string; bytes: Uint8Array; type: string };
}

export async function provideEvidence(client: PayPalClient, id: string, evidence: EvidenceSubmission, requestId: string) {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify({ evidences: [{ evidence_type: evidence.evidence_type, notes: evidence.notes }] })], { type: "application/json" }));
  form.append("evidence_file", new Blob([evidence.file.bytes], { type: evidence.file.type }), evidence.file.name);
  return client.send<unknown>("POST", path(id, "provide-evidence"), form, requestId);
}

/** PayPal refunds the buyer the disputed amount. */
export async function acceptClaim(client: PayPalClient, id: string, note: string, requestId: string) {
  return client.request<unknown>("POST", path(id, "accept-claim"), { note, accept_claim_type: "REFUND" }, requestId);
}

/** Sandbox helper: moves an inquiry to a claim, the step before PayPal offers adjudication. */
export async function escalate(client: PayPalClient, id: string, note: string) {
  sandboxOnly(client);
  return client.request<unknown>("POST", path(id, "escalate"), { note });
}

export async function adjudicate(client: PayPalClient, id: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR") {
  sandboxOnly(client);
  return client.request<unknown>("POST", path(id, "adjudicate"), { adjudication_outcome: outcome });
}

/** PayPal lists the actions it currently allows as HATEOAS links. */
export function hasAction(d: Dispute, rel: string): boolean {
  return (d.links ?? []).some((l) => l.rel === rel);
}

/** PayPal only accepts evidence types it requested from the seller. */
export function pickEvidenceType(d: Dispute, hasRefund: boolean): string {
  const requested = (d.evidences ?? []).filter((e) => e.source === "REQUESTED_FROM_SELLER").map((e) => e.evidence_type);
  if (d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && requested.includes("PROOF_OF_FULFILLMENT")) return "PROOF_OF_FULFILLMENT";
  if (hasRefund && requested.includes("PROOF_OF_REFUND")) return "PROOF_OF_REFUND";
  if (requested.includes("OTHER")) return "OTHER";
  return requested[0] ?? "OTHER";
}
