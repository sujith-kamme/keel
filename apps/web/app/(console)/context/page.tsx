import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { certBadge, isActive, isRunId, PACKS, packLabel, pickBeforeAfter, runName, runOutcome } from "@/lib/context-view";
import { gauntletCertification, gauntletRun, gauntletRuns, gauntletScenarios, OperatorError, requireConsole } from "@/lib/operator";
import { NewRunDrawer } from "./new-run-drawer";
import { ResultsGrid } from "./results-grid";
import { RunPicker } from "./run-picker";
import { RunTabs } from "./run-tabs";
import { ByPack, Kpis, Progress, RunHistory } from "./run-view";

type Search = Promise<{ run?: string | string[]; added?: string | string[]; new?: string | string[] }>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Body({ search }: { search: Search }) {
  await connection();
  await requireConsole();
  const sp = await search;
  const [cert, runs, scenarios] = await Promise.all([gauntletCertification(), gauntletRuns(), gauntletScenarios()]);
  const wanted = one(sp.run);
  const latestId = runs[0]?.id;
  const selectedId = isRunId(wanted) ? wanted : latestId;
  const selected = selectedId ? await gauntletRun(selectedId).catch((e) => (e instanceof OperatorError && e.status === 404 ? null : Promise.reject(e))) : null;
  const busy = runs.some((r) => isActive(r.status));
  const run = selected?.run;
  const results = selected?.results ?? [];
  const baseline = run?.guarded ? (pickBeforeAfter(runs)?.without.scorecard ?? null) : null;
  const cb = certBadge(cert.status);
  const runHref = selectedId ? `/context?run=${encodeURIComponent(selectedId)}` : "/context";
  return (
    <>
      <div className="ph">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1>Simulations</h1>
            <span className={`bdg ${cb.tone}`}>{cb.label}</span>
            {cert.run_id && isRunId(cert.run_id) && (
              <Link href={`/context?run=${encodeURIComponent(cert.run_id)}`} className="sm">
                Certifying run
              </Link>
            )}
          </div>
        </div>
        <div className="acts">
          {runs.length > 0 && (
            <RunPicker
              selectedId={selectedId}
              runs={runs.map((r) => ({ id: r.id, label: `${runName(r, latestId)} · ${r.guarded ? "Guarded" : "No reply guard"}` }))}
            />
          )}
          <Link id="new-run" className="b pri" href={`${runHref}${selectedId ? "&" : "?"}new=1`} scroll={false}>
            <i className="ic ic-plus s14" aria-hidden="true" />
            New run
          </Link>
        </div>
      </div>
      {one(sp.added) && (
        <p className="pnl" style={{ margin: 0, padding: "10px 16px", borderColor: "var(--ok-line)", background: "var(--ok-bg)", color: "var(--ok)" }} role="status">
          Scenario added to the Gauntlet.
        </p>
      )}
      {cert.reasons.length > 0 && (
        <ul className="sm mut" style={{ margin: "-8px 0 0", paddingLeft: 18, listStyle: "disc" }}>
          {cert.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {!run ? (
        <p className="pnl mut" style={{ margin: 0, padding: "12px 16px" }}>
          {runs.length === 0 ? "No runs yet. Start one with New run." : "Run not found."}
        </p>
      ) : (
        <>
          <div className="sm mut">
            <span className={`st ${runOutcome(run, cert).tone}`}>{runOutcome(run, cert).label}</span> · {runName(run, latestId)} · {run.guarded ? "Guarded" : "No reply guard"} · {run.packs.map(packLabel).join(", ")} · {run.repeats}×
          </div>
          {isActive(run.status) && <Progress run={run} />}
          {run.error && (
            <p className="pnl" style={{ margin: 0, padding: "10px 16px", borderColor: "var(--bad-line)", background: "var(--bad-bg)", color: "var(--bad)" }}>
              {run.error}
            </p>
          )}
          {run.scorecard && <Kpis sc={run.scorecard} baseline={baseline} />}
        </>
      )}
      <RunTabs
        tabs={[
          {
            id: "results",
            label: "Results",
            count: results.length,
            panel:
              run?.status === "DONE" && results.length > 0 ? (
                <ResultsGrid rows={results} />
              ) : (
                <p className="pnl-b mut" style={{ margin: 0 }}>
                  {run && isActive(run.status) ? "Results appear when the run finishes." : "No results."}
                </p>
              ),
          },
          { id: "packs", label: "By pack", count: new Set(results.map((r) => r.pack)).size, panel: <ByPack results={results} /> },
          {
            id: "runs",
            label: "Run history",
            count: runs.length,
            panel:
              runs.length > 0 ? (
                <RunHistory runs={runs} selectedId={selectedId} latestId={latestId} cert={cert} />
              ) : (
                <p className="pnl-b mut" style={{ margin: 0 }}>
                  No runs yet.
                </p>
              ),
          },
        ]}
      />
      {one(sp.new) && (
        <NewRunDrawer
          packs={PACKS.map((id) => ({ id, count: scenarios.filter((s) => s.pack === id).length }))}
          busy={busy}
          closeHref={runHref}
        />
      )}
      {busy && <AutoRefresh ms={2000} />}
    </>
  );
}

function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="pnl" style={{ height: 64 }} />
      <div className="kpis" style={{ height: 112 }} />
      <div className="pnl" style={{ height: 300 }} />
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Body search={searchParams} />
    </Suspense>
  );
}
