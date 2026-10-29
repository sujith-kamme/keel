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

// Mirrors apps/api/src/routes/turns.ts.
export interface SessionSummary {
  id: string;
  agent_id: string;
  claimed_email: string;
  verified: boolean;
  order_ids: string[];
  state: string;
  mode: "LIVE" | "CONTEXT";
  created_at: string;
  expires_at: string;
}

export interface SessionRow extends SessionSummary {
  risk_score: number | null;
  decision_count: number;
  last_turn_at: string | null;
}

export interface Turn {
  role: "customer" | "agent";
  text: string;
  decision_ids: string[];
  created_at: string;
}

export interface DecisionSummary {
  seq: number;
  decision_id: string;
  tool: string;
  order_id: string | null;
  verdict: string;
  reason_codes: string[];
  created_at: string;
  guard?: {
    draft: string;
    final_reply: string;
    commitments: { type: string; quoted_text: string }[];
    latency_ms: number | null;
  };
}

export interface SessionDetail {
  session: SessionSummary;
  turns: Turn[];
  decisions: DecisionSummary[];
  risk: { score: number; threshold: number; signals: { kind: string; weight: number; at: string }[] } | null;
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

export const sessionDetail = (id: string) => keel<SessionDetail>(`/v1/sessions/${encodeURIComponent(id)}`);

export const listSessions = (opts: { limit: number; state?: string; before?: string }) => {
  const q = new URLSearchParams({ limit: String(opts.limit), mode: "LIVE" });
  if (opts.state) q.set("state", opts.state);
  if (opts.before) q.set("before", opts.before);
  return keel<{ sessions: SessionRow[]; next_before: string | null }>(`/v1/sessions?${q}`);
};
