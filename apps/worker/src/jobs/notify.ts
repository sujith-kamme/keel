import type { DisputeNotice } from "./dispute";

export type NotifyEvent =
  | {
      event: "session.quarantined" | "action.held";
      session_id: string;
      decision_id: string;
      reason_codes: string[];
      score?: number;
      console_url: string;
      at: string;
    }
  | DisputeNotice;

export const HOOK_PREFIX = "https://hooks.zapier.com/";

export function notifyConfig(env: { ZAPIER_HOOK_URL?: string }): { hookUrl: string | null } {
  const url = env.ZAPIER_HOOK_URL?.trim();
  if (!url) return { hookUrl: null };
  // Never echo the value: it is a secret-bearing URL.
  if (!url.startsWith(HOOK_PREFIX)) throw new Error(`ZAPIER_HOOK_URL must start with ${HOOK_PREFIX}`);
  return { hookUrl: url };
}

// Copy exactly the known keys so nothing else in job data can leave the process.
function pick(e: NotifyEvent): NotifyEvent {
  if (e.event === "dispute.classified") {
    return { event: e.event, dispute_id: e.dispute_id, decision_id: e.decision_id, reason_codes: e.reason_codes, console_url: e.console_url, at: e.at };
  }
  const out: NotifyEvent = {
    event: e.event,
    session_id: e.session_id,
    decision_id: e.decision_id,
    reason_codes: e.reason_codes,
    console_url: e.console_url,
    at: e.at,
  };
  if (e.score !== undefined) out.score = e.score;
  return out;
}

export async function sendNotify(
  event: NotifyEvent,
  deps: { hookUrl: string | null; fetch: typeof fetch },
): Promise<{ skipped: true } | { status: number }> {
  if (!deps.hookUrl) {
    console.log(`notify skipped (no ZAPIER_HOOK_URL): ${event.event}`);
    return { skipped: true };
  }
  const res = await deps.fetch(deps.hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pick(event)),
    // Never follow a redirect off the allowlisted Zapier host.
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`zapier responded ${res.status}`);
  return { status: res.status };
}
