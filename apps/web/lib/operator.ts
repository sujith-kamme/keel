import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CONSOLE_COOKIE, consoleSessionChecker, consoleUser } from "./console-auth";
import { env } from "./env";
import type { Certification, Run, RunResult, ScenarioEntry, StartInput } from "./context-view";
import type { DisputeDetail, DisputeItem } from "./disputes-view";
import type { ChainResult, LedgerPage } from "./ledger-view";
import type { Overview } from "./overview-view";
import type { PolicyRow, PolicySummary, PolicyVersion, Rule } from "./policies-view";
import { errorMessage, type ReviewItem } from "./review-view";

export class OperatorError extends Error {
  constructor(
    readonly status: number,
    readonly error?: string,
    readonly reasonCode?: string,
    readonly retryAfterS?: number,
  ) {
    super(error ?? `Keel API responded ${status}`);
  }
}

export interface AgentControl {
  agent_id: string;
  frozen: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

let checkSession: ReturnType<typeof consoleSessionChecker> | undefined;

/**
 * The proxy's cookie check plus the account's current session version, so a password change or
 * "sign out everywhere" ends older sessions. Server actions are public endpoints, so they re-verify.
 * `user` is the account email, recorded as the operator on ledgered actions.
 */
export async function requireConsole(): Promise<{ user: string }> {
  const { webSecret, keelApiUrl, operatorKey } = env();
  checkSession ??= consoleSessionChecker({ url: keelApiUrl, key: operatorKey });
  const user = await consoleUser((await cookies()).get(CONSOLE_COOKIE)?.value, webSecret, new Date(), checkSession);
  if (!user) redirect("/login");
  return { user };
}

async function operator<T>(path: string, init?: RequestInit): Promise<T> {
  const { keelApiUrl, operatorKey } = env();
  const res = await fetch(`${keelApiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${operatorKey}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; reason_code?: string; retry_after_s?: number } | null;
    throw new OperatorError(res.status, body?.error, body?.reason_code, body?.retry_after_s);
  }
  return (await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const consoleLogin = (email: string, password: string, ip: string) =>
  operator<{ email: string; session_version: number }>("/v1/console/login", post({ email, password, ip }));

export const reviewQueue = async () => (await operator<{ items: ReviewItem[] }>("/v1/review")).items;

export const approveHeld = (decisionId: string, reviewer: string) =>
  operator<unknown>(`/v1/review/${encodeURIComponent(decisionId)}/approve`, post({ reviewer }));

export const denyHeld = (decisionId: string, reviewer: string) =>
  operator<unknown>(`/v1/review/${encodeURIComponent(decisionId)}/deny`, post({ reviewer }));

export const releaseSession = (sessionId: string, reviewer: string) =>
  operator<unknown>(`/v1/sessions/${encodeURIComponent(sessionId)}/release`, post({ reviewer }));

export const agentControl = (agentId: string) => operator<AgentControl>(`/v1/agents/${encodeURIComponent(agentId)}`);

export const setFrozen = (agentId: string, frozen: boolean, operatorName: string) =>
  operator<AgentControl>(`/v1/agents/${encodeURIComponent(agentId)}/${frozen ? "freeze" : "unfreeze"}`, post({ operator: operatorName }));

export const gauntletCertification = () => operator<Certification>("/v1/gauntlet/certification");

export const gauntletRuns = async () => (await operator<{ runs: Run[] }>("/v1/gauntlet/runs")).runs;

export const gauntletRun = (id: string) => operator<{ run: Run; results: RunResult[] }>(`/v1/gauntlet/runs/${encodeURIComponent(id)}`);

export const gauntletScenarios = async () => (await operator<{ scenarios: ScenarioEntry[] }>("/v1/gauntlet/scenarios")).scenarios;

export const startGauntletRun = (input: StartInput) => operator<{ run_id: string }>("/v1/gauntlet/runs", post(input));

export const draftScenario = async (sessionId: string) =>
  (await operator<{ scenario: Record<string, unknown> }>("/v1/gauntlet/drafts", post({ session_id: sessionId }))).scenario;

export const saveScenario = (scenario: Record<string, unknown>, sourceSessionId: string) =>
  operator<{ id: string }>("/v1/gauntlet/scenarios", post({ scenario, source_session_id: sourceSessionId }));

export const disputes = async () => (await operator<{ items: DisputeItem[] }>("/v1/disputes")).items;

export const dispute = (id: string) => operator<DisputeDetail>(`/v1/disputes/${encodeURIComponent(id)}`);

export const disputeAction = (id: string, kind: "evidence" | "accept", reviewer: string) =>
  operator<unknown>(`/v1/disputes/${encodeURIComponent(id)}/${kind === "evidence" ? "submit-evidence" : "accept-claim"}`, post({ reviewer }));

export const lookupDispute = (id: string) => operator<unknown>("/v1/disputes/lookup", post({ dispute_id: id }));

export const syncDisputes = () => operator<unknown>("/v1/disputes/sync", { method: "POST" });

export const sandboxDispute = (id: string, step: "escalate" | "adjudicate", outcome?: "SELLER_FAVOR" | "BUYER_FAVOR") =>
  operator<unknown>(`/v1/disputes/${encodeURIComponent(id)}/sandbox/${step}`, step === "adjudicate" ? post({ outcome }) : { method: "POST" });

/** The evidence PDF bytes, or null when there is none. */
export async function disputeEvidencePdf(id: string): Promise<ArrayBuffer | null> {
  const { keelApiUrl, operatorKey } = env();
  const res = await fetch(`${keelApiUrl}/v1/disputes/${encodeURIComponent(id)}/evidence.pdf`, {
    headers: { authorization: `Bearer ${operatorKey}` },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new OperatorError(res.status);
  return res.arrayBuffer();
}

/** The most recent 2,000 ledger rows, or the 2,000 before `beforeSeq`. */
export const ledgerPage = (beforeSeq?: number) =>
  operator<LedgerPage>(`/v1/ledger?limit=2000${beforeSeq === undefined ? "" : `&before_seq=${beforeSeq}`}`);

export const verifyLedger = () => operator<ChainResult>("/v1/ledger/verify");

export const overview = () => operator<Overview>("/v1/overview");

/** Natural language → AG Grid state ("Ask the ledger"). Only the query and the grid's schema are sent, never rows. */
export const gridQuery = async (query: string, schema: Record<string, unknown>) =>
  (await operator<{ state: Record<string, unknown> }>("/v1/grid-query", post({ query, schema }))).state;

export const policies = async () => (await operator<{ policies: PolicySummary[] }>("/v1/policies")).policies;

export const policyVersions = async (id: string) => (await operator<{ versions: PolicyVersion[] }>(`/v1/policies/${encodeURIComponent(id)}`)).versions;

/** Claude drafts a new version from the document; it is saved as a DRAFT. */
export const draftPolicy = (id: string, document: string) =>
  operator<{ version: number; policy: PolicyRow }>("/v1/policies/draft", post({ policy_id: id, document }));

export const approvePolicy = (id: string, version: number, edits: { reviewer: string; approved_text: string; rules: Rule[] }) =>
  operator<unknown>(`/v1/policies/${encodeURIComponent(id)}/versions/${version}/approve`, post(edits));

/** The ledger JSON export as a stream. */
export async function ledgerExport(): Promise<ReadableStream<Uint8Array>> {
  const { keelApiUrl, operatorKey } = env();
  const res = await fetch(`${keelApiUrl}/v1/ledger/export.json`, {
    headers: { authorization: `Bearer ${operatorKey}` },
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  if (!res.ok || !res.body) throw new OperatorError(res.status);
  return res.body;
}

export type ActionResult = { ok: true } | { ok: false; message: string };

/** Turns an API failure into an inline message; anything else is rethrown. */
export async function toResult(fn: () => Promise<unknown>, message = errorMessage): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof OperatorError) return { ok: false, message: message(e.status, e.error, e.reasonCode) };
    throw e;
  }
}
