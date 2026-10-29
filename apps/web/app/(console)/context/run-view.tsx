import Link from "next/link";
import { type Certification, packLabel, packStats, pct, progressPct, type Run, type RunResult, runOutcome, type Scorecard } from "@/lib/context-view";
import { usd, utcTime } from "@/lib/overview-view";

const n = (x: number) => x.toLocaleString("en-US");
// Run rows come straight from stored JSON; an older or interrupted run may lack a count.
const count = (x: number | undefined) => (typeof x === "number" ? n(x) : "—");

function Kpi({ label, value, notes }: { label: string; value: string; notes: (string | null | false)[] }) {
  return (
    <div className="kpi">
      <span className="lbl">{label}</span>
      <span className="v">{value}</span>
      {notes.filter(Boolean).map((t) => (
        <span key={t as string} className="sm dim">
          {t}
        </span>
      ))}
    </div>
  );
}

/** The selected run's scorecard; `baseline` is the newest finished run without the reply guard, for comparison. */
export function Kpis({ sc, baseline }: { sc: Scorecard; baseline: Scorecard | null }) {
  const without = (v: string) => baseline !== null && `${v} without guard`;
  const byType = Object.entries(sc.leaks_by_type)
    .map(([k, c]) => `${k} ${c}`)
    .join(" · ");
  return (
    <div className="kpis grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Leaks" value={n(sc.leaks)} notes={[byType, without(n(baseline?.leaks ?? 0))]} />
      <Kpi label="Pass rate" value={pct(sc.pass_rate)} notes={[sc.errors > 0 && `${n(sc.errors)} errored, not rated`, without(pct(baseline?.pass_rate ?? null))]} />
      <Kpi label="False positives" value={pct(sc.false_positive_rate)} notes={[without(pct(baseline?.false_positive_rate ?? null)) || "of honest conversations"]} />
      <Kpi label="Trigger rate" value={pct(sc.trigger_rate)} notes={["of attacks, Keel acted as expected"]} />
      <Kpi label="Guard latency p50" value={sc.median_guard_latency_ms === null ? "—" : `${n(Math.round(sc.median_guard_latency_ms))} ms`} notes={["per guard call"]} />
      <Kpi label="Dollars protected" value={usd(sc.dollars_protected)} notes={["refunds refused in this run"]} />
    </div>
  );
}

export function Progress({ run }: { run: Run }) {
  const p = progressPct(run.progress);
  return (
    <div className="pnl" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sm" style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 500 }}>{run.status === "QUEUED" ? "Queued" : "Running"}</span>
        <span className="mut">
          {n(run.progress.done)} / {n(run.progress.total)} conversations
        </span>
      </div>
      <div className="meter" role="progressbar" aria-label="Run progress" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${p}%`, background: "var(--accent)" }} />
      </div>
    </div>
  );
}

export function ByPack({ results }: { results: RunResult[] }) {
  const stats = packStats(results);
  if (stats.length === 0) return <p className="pnl-b mut" style={{ margin: 0 }}>No results yet.</p>;
  return (
    <div className="tw">
      <table className="t" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th scope="col">Pack</th>
            <th scope="col" className="r">
              Conversations
            </th>
            <th scope="col" className="r">
              Passed
            </th>
            <th scope="col" className="r">
              Leaks
            </th>
            <th scope="col" className="r">
              False positives
            </th>
            <th scope="col" className="r">
              Errors
            </th>
            <th scope="col" style={{ width: "28%" }}>
              Pass rate
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.pack}>
              <td>{packLabel(s.pack)}</td>
              <td className="r">{n(s.conversations)}</td>
              <td className="r">{n(s.passed)}</td>
              <td className="r">{n(s.leaks)}</td>
              <td className="r">{s.falsePositives === null ? "—" : n(s.falsePositives)}</td>
              <td className="r">{n(s.errors)}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="meter" style={{ flex: 1 }}>
                    <span style={{ width: `${(s.passRate ?? 0) * 100}%`, background: s.passRate === 1 ? "var(--ok-dot)" : "var(--warn-dot)" }} />
                  </div>
                  <span className="sm mono" style={{ width: 48, textAlign: "right" }}>
                    {pct(s.passRate)}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunHistory({ runs, selectedId, cert }: { runs: Run[]; selectedId: string | undefined; cert: Certification }) {
  return (
    <div className="tw">
      <table className="t" style={{ minWidth: 760 }}>
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">Started (UTC)</th>
            <th scope="col">Mode</th>
            <th scope="col" className="r">
              Conversations
            </th>
            <th scope="col" className="r">
              Leaks
            </th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const o = runOutcome(r, cert);
            return (
              <tr key={r.id} className={r.id === selectedId ? "selr" : undefined}>
                <td className="mono">
                  <Link href={`/context?run=${encodeURIComponent(r.id)}`}>{r.id}</Link>
                </td>
                <td className="mut">{utcTime(r.created_at)}</td>
                <td>{r.guarded ? "Guarded" : "No reply guard"}</td>
                <td className="r">{count(r.scorecard?.runs ?? r.progress?.total)}</td>
                <td className="r">{count(r.scorecard?.leaks)}</td>
                <td>
                  <span className={`st ${o.tone}`}>{o.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
