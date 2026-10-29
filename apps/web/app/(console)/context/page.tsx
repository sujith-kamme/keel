import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { certLabel, certStyle, isActive, isRunId } from "@/lib/context-view";
import { gauntletCertification, gauntletRun, gauntletRuns, gauntletScenarios, OperatorError, requireConsole } from "@/lib/operator";
import { RunForm } from "./run-form";
import { BeforeAfter, RunView } from "./run-view";

type Search = Promise<{ run?: string | string[]; added?: string | string[] }>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Body({ search }: { search: Search }) {
  await connection();
  await requireConsole();
  const sp = await search;
  const [cert, runs, scenarios] = await Promise.all([gauntletCertification(), gauntletRuns(), gauntletScenarios()]);
  const wanted = one(sp.run);
  const selectedId = isRunId(wanted) ? wanted : runs[0]?.id;
  const selected = selectedId ? await gauntletRun(selectedId).catch((e) => (e instanceof OperatorError && e.status === 404 ? null : Promise.reject(e))) : null;
  const busy = runs.some((r) => isActive(r.status));
  const active = selected !== null && isActive(selected.run.status);
  const v = cert.current_versions;
  return (
    <>
      {one(sp.added) && <p className="mt-4 rounded bg-green-100 px-3 py-2 text-sm text-green-800 dark:bg-green-900/40 dark:text-green-200">Scenario added to the Gauntlet.</p>}
      <div className="mt-4 flex items-center gap-3">
        <span className={`rounded px-2 py-1 text-sm font-medium ${certStyle(cert.status)}`}>{certLabel(cert.status)}</span>
        {cert.run_id && isRunId(cert.run_id) && (
          <Link href={`/context?run=${encodeURIComponent(cert.run_id)}`} className="text-xs underline">
            certifying run
          </Link>
        )}
      </div>
      {cert.reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {cert.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs opacity-70">
        Agent {v.agent_model} ({v.agent_prompt}) · extractor {v.extractor_model} ({v.extractor_prompt_version}) · policies{" "}
        {Object.entries(v.policies)
          .map(([id, n]) => `${id} v${n}`)
          .join(", ")}
      </p>
      <RunForm busy={busy} hasLearned={scenarios.some((s) => s.source === "learned")} />
      <BeforeAfter runs={runs} />
      {selected && <RunView run={selected.run} results={selected.results} />}
      <h2 className="mt-6 text-sm font-medium">Recent runs</h2>
      <ul className="mt-2 flex max-w-2xl flex-col gap-1 text-sm">
        {runs.length === 0 && <li className="opacity-70">No runs yet.</li>}
        {runs.map((r) => (
          <li key={r.id}>
            <Link href={`/context?run=${encodeURIComponent(r.id)}`} className={r.id === selectedId ? "font-semibold underline" : "underline"}>
              {r.created_at}
            </Link>{" "}
            · {r.guarded ? "Guarded" : "Without reply guard"} · {r.status}
            {r.scorecard ? ` · ${r.scorecard.leaks} leak(s)` : ""}
          </li>
        ))}
      </ul>
      {(active || busy) && <AutoRefresh ms={2000} />}
    </>
  );
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Context Mode</h1>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Body search={searchParams} />
      </Suspense>
    </section>
  );
}
