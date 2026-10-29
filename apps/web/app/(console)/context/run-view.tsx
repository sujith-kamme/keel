import { pct, progressPct, type Run, type Scorecard } from "@/lib/context-view";
import { usd } from "@/lib/overview-view";

const n = (x: number) => x.toLocaleString("en-US");

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
