import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { OperatorError, overview, requireConsole, reviewQueue } from "@/lib/operator";
import { activity, certStrip, usd, VERDICT_SERIES, type Overview } from "@/lib/overview-view";
import { reasonLabel } from "@/lib/reason-labels";
import { REVIEW_LIMIT } from "@/lib/review-view";
import { DecisionsChart } from "./overview-charts";
import { RecentGrid } from "./recent-grid";

const n = (x: number) => x.toLocaleString("en-US");

// OK isn't a reason anything was stopped, even on the odd row that carries it.
const topReasons = (o: Overview) => o.violations.all_time.byReason.filter((r) => r.code !== "OK");

const SHIELD = { ok: "var(--ok-dot)", warn: "var(--warn-dot)", neu: "var(--neu-dot)" } as const;

function Certification({ o }: { o: Overview }) {
  const c = certStrip(o.certification);
  return (
    <div className="pnl" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", flexWrap: "wrap" }}>
      <i className="ic ic-shield" style={{ color: SHIELD[c.tone], width: 18, height: 18, maskSize: "18px 18px", WebkitMaskSize: "18px 18px" }} aria-hidden="true" />
      <span style={{ fontWeight: 600 }}>{c.title}</span>
      <span className="mut" style={{ minWidth: 0, flex: "1 1 320px" }}>
        {c.runId && "Guarded run "}
        {c.detail}
      </span>
      {c.runId && (
        <Link href={`/context?run=${encodeURIComponent(c.runId)}`} style={{ marginLeft: "auto", fontWeight: 500 }}>
          View scorecard
        </Link>
      )}
    </div>
  );
}

function Kpis({ o, inReview }: { o: Overview; inReview: number | null }) {
  const d = o.dollars_protected;
  const v = o.violations;
  const top = topReasons(o)[0];
  const disputes = o.disputes;
  return (
    <div className="kpis grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <div className="kpi">
        <span className="lbl">Dollars protected</span>
        <span className="v">{usd(d.all_time.total)}</span>
        <span className="sm dim">
          {usd(d.all_time.blocked_refunds)} blocked · {usd(d.all_time.denied_holds)} denied · {usd(d.all_time.disputes_won)} won
        </span>
        <span className="sm dim">{usd(d.last_7_days.total)} in the last 7 days</span>
      </div>
      <div className="kpi">
        <span className="lbl">Violations caught</span>
        <span className="v">{n(v.all_time.total)}</span>
        {top && (
          <span className="sm dim">
            Top reason: {reasonLabel(top.code).toLowerCase()} ({n(top.count)})
          </span>
        )}
        <span className="sm dim">{n(v.last_7_days.total)} in the last 7 days</span>
      </div>
      <div className="kpi">
        <span className="lbl">Disputes resolved</span>
        <span className="v">{n(disputes.WON + disputes.CONCEDED + disputes.LOST)}</span>
        <span className="sm dim">
          {n(disputes.WON)} won · {n(disputes.CONCEDED)} conceded · {n(disputes.LOST)} lost
        </span>
        <span className="sm dim">
          {n(disputes.OPEN)} open · {usd(disputes.amount_conceded)} conceded
        </span>
      </div>
      <div className="kpi">
        <span className="lbl">Conversations</span>
        <span className="v">{n(o.sessions.active)}</span>
        <span className="sm dim">
          {n(o.sessions.quarantined)} quarantined
          {inReview !== null && ` · ${inReview >= REVIEW_LIMIT ? `${REVIEW_LIMIT}+` : n(inReview)} in review`}
        </span>
      </div>
    </div>
  );
}

function Decisions({ o }: { o: Overview }) {
  return (
    <section className="pnl" aria-labelledby="dec-h" style={{ minWidth: 0 }}>
      <div className="pnl-h">
        <h2 id="dec-h">Decisions</h2>
        <div className="sm mut" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {VERDICT_SERIES.map((s) => (
            <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: `var(${s.color})` }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <div className="pnl-b">
        <DecisionsChart days={o.decisions_by_day} />
        <p className="sm dim" style={{ margin: "4px 0 0" }}>
          Ledger rows per UTC day, last 14 days
        </p>
      </div>
    </section>
  );
}

function ReasonCodes({ o }: { o: Overview }) {
  const rows = topReasons(o).slice(0, 5);
  return (
    <section className="pnl" aria-labelledby="rc-h" style={{ minWidth: 0 }}>
      <div className="pnl-h">
        <h2 id="rc-h">Top reason codes</h2>
        <span className="sm dim">All time</span>
      </div>
      {rows.length === 0 ? (
        <p className="pnl-b mut" style={{ margin: 0 }}>
          No violations caught yet.
        </p>
      ) : (
        <table className="t">
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td style={{ whiteSpace: "normal", height: "auto", padding: "8px 12px" }}>
                  <div>{reasonLabel(r.code)}</div>
                  <div className="mono dim">{r.code}</div>
                </td>
                <td className="r">{n(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function RecentActivity({ o }: { o: Overview }) {
  const rows = o.recent_activity.map(activity);
  return (
    <section className="pnl" aria-labelledby="act-h">
      <div className="pnl-h">
        <h2 id="act-h">Recent activity</h2>
        <Link href="/ledger" className="sm">
          Open ledger
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="pnl-b mut" style={{ margin: 0 }}>
          No live activity yet.
        </p>
      ) : (
        <RecentGrid rows={rows} />
      )}
    </section>
  );
}

async function Body() {
  await connection();
  await requireConsole();
  let o: Overview;
  let inReview: number | null;
  try {
    // The review count is a nicety on the Conversations card; the page still shows without it.
    [o, inReview] = await Promise.all([overview(), reviewQueue().then((q) => q.length, () => null)]);
  } catch (e) {
    return (
      <p className="pnl mut" style={{ margin: 0, padding: "12px 16px", color: "var(--bad)" }}>
        Couldn&apos;t load the overview{e instanceof OperatorError ? ` (${e.status})` : ""}. Try again in a moment.
      </p>
    );
  }
  return (
    <>
      <Certification o={o} />
      <Kpis o={o} inReview={inReview} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" style={{ alignItems: "stretch" }}>
        <Decisions o={o} />
        <ReasonCodes o={o} />
      </div>
      <RecentActivity o={o} />
    </>
  );
}

function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="pnl" style={{ height: 46 }} />
      <div className="kpis" style={{ height: 112 }} />
      <div className="pnl" style={{ height: 300 }} />
    </div>
  );
}

export default function Page() {
  return (
    <>
      <div className="ph">
        <div>
          <h1>Overview</h1>
        </div>
        <div className="acts">
          <Link className="b pri" href="/context">
            Run Gauntlet
          </Link>
        </div>
      </div>
      <Suspense fallback={<Skeleton />}>
        <Body />
      </Suspense>
    </>
  );
}
