import "server-only";
import { env } from "./env";

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
  delivered_at: string;
}

export interface StartedSession {
  session_id: string;
  capability_token: string;
  orders: string[];
  expires_at: string;
  demo_otp?: string;
}

export interface SessionDetail {
  session: Record<string, unknown>;
  turns: { role: "customer" | "agent"; text: string; decision_ids: string[]; [key: string]: unknown }[];
  decisions: Record<string, unknown>[];
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

export const ordersFor = async (email: string) =>
  (await keel<{ orders: StoreOrder[] }>(`/v1/store/orders?customer_email=${encodeURIComponent(email)}`)).orders;

export const startSession = (email: string, orderIds: string[]) =>
  keel<StartedSession>("/v1/sessions", post({ agent_id: "agt_demo_store", customer_email: email, order_ids: orderIds }));

export const verifySession = (id: string, code: string) =>
  keel<{ session_id: string; capability_token: string }>(`/v1/sessions/${encodeURIComponent(id)}/verify`, post({ code }));

export const sessionDetail = (id: string) => keel<SessionDetail>(`/v1/sessions/${encodeURIComponent(id)}`);

export const listSessions = async (limit: number) =>
  (await keel<{ sessions: Record<string, unknown>[] }>(`/v1/sessions?limit=${encodeURIComponent(String(limit))}`)).sessions;

export const appendTurn = (id: string, turn: { role: "customer" | "agent"; text: string; decision_ids: string[] }) =>
  keel<unknown>(`/v1/sessions/${encodeURIComponent(id)}/turns`, post(turn));
