import "server-only";
import { agentConfigReader } from "./agent-config";
import { env } from "./env";

// The store's client for the Keel API. It holds only the merchant key: the store is Tidewell's site, not Keel's console.

export class KeelError extends Error {
  constructor(
    readonly status: number,
    readonly error?: string,
  ) {
    super(error ?? `Keel API responded ${status}`);
  }
}

export interface StoreOrder {
  order_id: string;
  scenario: string;
  total: { value: string; currency: string };
  items: { sku: string; title: string; price: string }[];
  delivered_at: string | null;
}

export interface StartedSession {
  session_id: string;
  capability_token: string;
  orders: string[];
  expires_at: string;
  demo_otp?: string;
}

export interface Turn {
  role: "customer" | "agent";
  text: string;
  decision_ids: string[];
  created_at: string;
}

export interface DecisionSummary {
  decision_id: string;
  tool: string;
  order_id: string | null;
  verdict: string;
  reason_codes: string[];
}

export interface SessionDetail {
  turns: Turn[];
  decisions: DecisionSummary[];
}

async function keel<T>(path: string, init?: RequestInit): Promise<T> {
  const { keelApiUrl, merchantKey } = env();
  const res = await fetch(`${keelApiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${merchantKey}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(90_000), // free-tier cold start
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new KeelError(res.status, body?.error);
  }
  return (await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export interface CatalogItem {
  sku: string;
  title: string;
  image_url: string | null;
  price: string;
  currency: string;
  category: string;
}

export const catalog = async () => (await keel<{ items: CatalogItem[] }>("/v1/store/catalog")).items;

export const ordersFor = async (email: string) =>
  (await keel<{ orders: StoreOrder[] }>(`/v1/store/orders?customer_email=${encodeURIComponent(email)}`)).orders;

export const startSession = (email: string, orderIds: string[]) =>
  keel<StartedSession>("/v1/sessions", post({ agent_id: "agt_demo_store", customer_email: email, order_ids: orderIds }));

export const verifySession = (id: string, code: string) =>
  keel<{ session_id: string; capability_token: string }>(`/v1/sessions/${encodeURIComponent(id)}/verify`, post({ code }));

export const sessionDetail = (id: string) => keel<SessionDetail>(`/v1/sessions/${encodeURIComponent(id)}`);

export const appendTurn = (id: string, turn: { role: "customer" | "agent"; text: string; decision_ids: string[] }) =>
  keel<unknown>(`/v1/sessions/${encodeURIComponent(id)}/turns`, post(turn));

export interface GuardResult {
  verdict: "ALLOW" | "REWRITE" | "BLOCK" | "HOLD";
  reason_codes: string[];
  final_reply: string;
  decision_id: string;
  session_state: string;
}

export const guardReply = (body: {
  session_id: string;
  draft_reply: string;
  conversation: { role: "customer" | "agent"; text: string }[];
  tool_calls_this_turn: string[];
}) => keel<GuardResult>("/v1/guard", post(body));

let readAgentConfig: ReturnType<typeof agentConfigReader> | undefined;
/** The agent model and prompt the Gauntlet certifies, read from the API settings (cached 5 s). */
export const agentConfig = () => (readAgentConfig ??= agentConfigReader({ url: env().keelApiUrl, key: env().merchantKey }))();

