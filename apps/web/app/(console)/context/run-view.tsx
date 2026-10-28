import { pct, pickBeforeAfter, progressPct, type Run, type RunResult, type Scorecard } from "@/lib/context-view";
import { ResultsGrid } from "./results-grid";

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded border border-black/10 p-3 dark:border-white/10">
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {note && <div className="text-xs opacity-70">{note}</div>}
    </div>
  );
}

function Scorecards({ sc }: { sc: Scorecard }) {
  const byType = Object.entries(sc.leaks_by_type)
    .map(([k, n]) => `${k}: ${n}`)
    .join(", ");
  return (
    <div className="mt-4 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">
      <Tile label="Pass rate" value={pct(sc.pass_rate)} />
      <Tile label="Leaks" value={String(sc.leaks)} note={byType || undefined} />
      <Tile label="False-positive rate" value={pct(sc.false_positive_rate)} />
      <Tile label="Trigger rate" value={pct(sc.trigger_rate)} />
      <Tile label="Dollars protected" value={`$${sc.dollars_protected}`} />
      <Tile label="Median guard latency" value={sc.median_guard_latency_ms === null ? "—" : `${sc.median_guard_latency_ms} ms`} />
    </div>
  );
}

export function RunView({ run, results }: { run: Run; results: RunResult[] }) {
  const mode = run.guarded ? "Guarded" : "Without reply guard";
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium">
        Run {run.id} · {mode} · {run.status}
      </h2>
      <p className="text-xs opacity-70">
        {run.packs.join(", ")} · {run.repeats}x
      </p>
      {(run.status === "QUEUED" || run.status === "RUNNING") && (
        <div className="mt-2 max-w-md">
          <div className="flex justify-between text-xs">
            <span>Progress</span>
            <span>
              {run.progress.done} / {run.progress.total}
            </span>
          </div>
          <div className="mt-1 h-2 rounded bg-black/10 dark:bg-white/10">
            <div className="h-2 rounded bg-blue-500" style={{ width: `${progressPct(run.progress)}%` }} />
          </div>
        </div>
      )}
      {run.error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{run.error}</p>}
      {run.scorecard && <Scorecards sc={run.scorecard} />}
      {run.status === "DONE" && results.length > 0 && <ResultsGrid rows={results} />}
    </div>
  );
}

function Column({ title, sc }: { title: string; sc: Scorecard }) {
  return (
    <div className="rounded border border-black/10 p-3 dark:border-white/10">
      <div className="text-sm font-medium">{title}</div>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
        <dt className="opacity-70">Leaks</dt>
        <dd>{sc.leaks}</dd>
        <dt className="opacity-70">Pass rate</dt>
        <dd>{pct(sc.pass_rate)}</dd>
        <dt className="opacity-70">False-positive rate</dt>
        <dd>{pct(sc.false_positive_rate)}</dd>
      </dl>
    </div>
  );
}

export function BeforeAfter({ runs }: { runs: Run[] }) {
  const pair = pickBeforeAfter(runs);
  if (!pair) return null;
  return (
    <div className="mt-6 grid max-w-xl grid-cols-2 gap-3">
      <Column title="Without reply guard" sc={pair.without.scorecard} />
      <Column title="With Keel" sc={pair.with.scorecard} />
    </div>
  );
}
