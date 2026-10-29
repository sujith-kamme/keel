import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { listSessions } from "@/lib/keel";
import { requireConsole } from "@/lib/operator";
import { isSessionId } from "@/lib/review-view";
import { relativeTime, SESSION_STATES, sessionsHref } from "@/lib/sessions-view";
import { type SessionListRow, SessionTable } from "./session-table";

const PAGE_SIZE = 20;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Sessions({ searchParams }: Pick<PageProps<"/sessions">, "searchParams">) {
  await connection();
  await requireConsole();
  const sp = await searchParams;
  const rawState = one(sp.state);
  const state = SESSION_STATES.find((s) => s === rawState) ?? null;
  // A malformed cursor list starts again from the first page.
  const rawPages = one(sp.pages)?.split(",") ?? [];
  const pages = rawPages.every(isSessionId) ? rawPages : [];
  const { sessions, next_before } = await listSessions({ limit: PAGE_SIZE, state: state ?? undefined, before: pages.at(-1) });

  if (sessions.length === 0 && state === null && pages.length === 0) {
    return (
      <p className="mut">
        No sessions yet. <Link href="/store">Start one in the demo store</Link>.
      </p>
    );
  }
  const now = new Date();
  const rows: SessionListRow[] = sessions.map((s) => ({
    id: s.id,
    email: s.claimed_email,
    verified: s.verified,
    agentId: s.agent_id,
    orderIds: s.order_ids,
    state: s.state,
    risk: s.risk_score,
    decisions: s.decision_count,
    lastTurn: s.last_turn_at ? relativeTime(s.last_turn_at, now) : null,
  }));
  return (
    <SessionTable
      rows={rows}
      state={state}
      previous={pages.length > 0 ? sessionsHref(state, pages.slice(0, -1)) : null}
      next={next_before ? sessionsHref(state, [...pages, next_before]) : null}
    />
  );
}

export default function Page({ searchParams }: PageProps<"/sessions">) {
  return (
    <>
      <div className="ph">
        <div>
          <h1>Live sessions</h1>
          <p>Every customer conversation with the agent, its state and risk.</p>
        </div>
      </div>
      <Suspense fallback={<p className="mut">Loading…</p>}>
        <Sessions searchParams={searchParams} />
      </Suspense>
      <AutoRefresh ms={3000} />
    </>
  );
}
