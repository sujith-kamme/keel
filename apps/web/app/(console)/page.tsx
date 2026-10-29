import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { OperatorError, overview, requireConsole } from "@/lib/operator";
import { certSummary, usd, type Overview } from "@/lib/overview-view";
import { OverviewCharts } from "./overview-charts";

function Card({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  return (
    <div className="rounded border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium opacity-80">{title}</h2>
        {href && (
          <Link href={href} className="text-xs underline">
            Open
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => <p className="mt-2 text-3xl font-semibold tabular-nums">{children}</p>;

function Cards({ o }: { o: Overview }) {
  const cert = certSummary(o.certification);
  const v = o.violations;
  const d = o.dollars_protected;
  const disputes = o.disputes;
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card title="Certification" href="/context">
        <span className={`mt-2 inline-block rounded px-2 py-1 text-sm font-medium ${cert.style}`}>{cert.label}</span>
        <p className="mt-2 text-sm">{cert.reason}</p>
      </Card>
      <Card title="Live sessions" href="/sessions">
        <Big>{o.sessions.active}</Big>
        <p className="text-sm">active</p>
        <p className={`mt-1 text-sm ${o.sessions.quarantined > 0 ? "font-medium text-red-700 dark:text-red-300" : ""}`}>{o.sessions.quarantined} quarantined</p>
      </Card>
      <Card title="Violations caught">
        <Big>{v.all_time.total.toLocaleString("en-US")}</Big>
        <p className="text-sm">all time · {v.last_7_days.total.toLocaleString("en-US")} in the last 7 days</p>
        {v.all_time.byReason.length > 0 && (
          <ul className="mt-2 text-xs">
            {v.all_time.byReason.slice(0, 5).map((r) => (
              <li key={r.code} className="flex justify-between gap-2">
                <span className="font-mono">{r.code}</span>
                <span className="tabular-nums">{r.count.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Dollars protected">
        <Big>{usd(d.all_time.total)}</Big>
        <p className="text-sm">all time · {usd(d.last_7_days.total)} in the last 7 days</p>
        <ul className="mt-2 text-xs">
          <li className="flex justify-between gap-2">
            <span>Refunds blocked</span>
            <span className="tabular-nums">{usd(d.all_time.blocked_refunds)}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span>Held refunds denied</span>
            <span className="tabular-nums">{usd(d.all_time.denied_holds)}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span>Disputes won</span>
            <span className="tabular-nums">{usd(d.all_time.disputes_won)}</span>
          </li>
        </ul>
      </Card>
      <Card title="Disputes" href="/disputes">
        <p className="mt-2 text-sm">
          {disputes.WON} won · {disputes.CONCEDED} conceded · {disputes.LOST} lost · {disputes.OPEN} open
        </p>
        <p className="mt-1 text-sm">
          {usd(disputes.amount_won)} won · {usd(disputes.amount_conceded)} conceded
        </p>
      </Card>
      <Card title="Kill switch">
        <p className="mt-2 text-sm">Freeze every agent, or one, from the Agents page.</p>
        <Link href="/agents" className="mt-2 inline-block text-sm underline">
          Kill switch → Agents
        </Link>
      </Card>
    </div>
  );
}

async function Body() {
  await connection();
  await requireConsole();
  let o: Overview;
  try {
    o = await overview();
  } catch (e) {
    return (
      <p className="mt-4 rounded bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-200">
        Couldn&apos;t load the overview{e instanceof OperatorError ? ` (${e.status})` : ""}. Try again in a moment.
      </p>
    );
  }
  return (
    <>
      <Cards o={o} />
      <OverviewCharts days={o.decisions_by_day} disputes={o.disputes} />
    </>
  );
}

function Skeleton() {
  return (
    <div className="mt-4 grid animate-pulse gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-36 rounded bg-black/5 dark:bg-white/10" />
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="mt-1 text-sm opacity-80">What Keel caught on live traffic, and what it saved. Gauntlet runs are left out.</p>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </section>
  );
}
