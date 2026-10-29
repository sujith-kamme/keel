"use client";

import { type ColDef, type ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { ListGrid } from "@/components/list-grid";
import { agentCert, agentName, type Certification, packLabel, packStats, type PackStats, pct, type Run, type RunResult, runName, runOutcome } from "@/lib/context-view";

const num = { type: "rightAligned", width: 130 } as const;
// Run rows come straight from stored JSON; an older or interrupted run may lack a count.
const count = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : "—");

const packColumns: ColDef<PackStats>[] = [
  { headerName: "Pack", field: "pack", valueFormatter: (p) => packLabel(p.value ?? ""), width: 200 },
  { headerName: "Conversations", field: "conversations", ...num, valueFormatter: (p) => count(p.value) },
  { headerName: "Passed", field: "passed", ...num, valueFormatter: (p) => count(p.value) },
  { headerName: "Leaks", field: "leaks", ...num, valueFormatter: (p) => count(p.value) },
  { headerName: "False positives", field: "falsePositives", ...num, valueFormatter: (p) => count(p.value) },
  { headerName: "Errors", field: "errors", ...num, valueFormatter: (p) => count(p.value) },
  {
    headerName: "Pass rate",
    field: "passRate",
    flex: 1,
    minWidth: 200,
    cellRenderer: ({ value }: ICellRendererParams<PackStats, number | null>) => (
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: "100%" }}>
        <div className="meter" style={{ flex: 1 }}>
          <span style={{ width: `${(value ?? 0) * 100}%`, background: value === 1 ? "var(--ok-dot)" : "var(--warn-dot)" }} />
        </div>
        <span className="sm mono" style={{ width: 48, textAlign: "right" }}>
          {pct(value ?? null)}
        </span>
      </div>
    ),
  },
];

export function ByPack({ results }: { results: RunResult[] }) {
  const stats = packStats(results);
  if (stats.length === 0)
    return (
      <p className="pnl-b mut" style={{ margin: 0 }}>
        No results yet.
      </p>
    );
  return <ListGrid rows={stats} columns={packColumns} rowId={(s) => s.pack} />;
}

type HistoryRow = { run: Run; name: string; outcome: { label: string; tone: string } };

const runHref = (r: HistoryRow) => `/context?run=${encodeURIComponent(r.run.id)}`;

const historyColumns: ColDef<HistoryRow>[] = [
  {
    headerName: "Run",
    field: "name",
    flex: 1,
    minWidth: 200,
    // Sorts by start time, not by the "Latest · " label.
    comparator: (_a, _b, x, y) => (x.data?.run.created_at ?? "").localeCompare(y.data?.run.created_at ?? ""),
    cellRenderer: ({ data, value }: ICellRendererParams<HistoryRow, string>) => (data ? <Link href={runHref(data)}>{value}</Link> : null),
  },
  { headerName: "Agent", colId: "agent", valueGetter: (p) => agentName(p.data?.run.agent_id ?? null), width: 150 },
  { headerName: "Started by", colId: "by", valueGetter: (p) => (p.data?.run.created_by === "auto" ? "Re-certification" : "Operator"), width: 150, cellClass: "mut" },
  { headerName: "Mode", colId: "mode", valueGetter: (p) => (p.data?.run.guarded ? "Guarded" : "No reply guard"), width: 160 },
  { headerName: "Conversations", colId: "conversations", valueGetter: (p) => p.data?.run.scorecard?.runs ?? p.data?.run.progress?.total, ...num, valueFormatter: (p) => count(p.value) },
  { headerName: "Leaks", colId: "leaks", valueGetter: (p) => p.data?.run.scorecard?.leaks, ...num, valueFormatter: (p) => count(p.value) },
  {
    headerName: "Result",
    colId: "result",
    valueGetter: (p) => p.data?.outcome.label,
    width: 160,
    cellRenderer: ({ data }: ICellRendererParams<HistoryRow>) => (data ? <span className={`st ${data.outcome.tone}`}>{data.outcome.label}</span> : null),
  },
];

export function RunHistory({ runs, latestId, cert }: { runs: Run[]; latestId: string | undefined; cert: Certification }) {
  const rows = runs.map((run) => ({ run, name: runName(run, latestId), outcome: runOutcome(run, agentCert(cert, run.agent_id)) }));
  return <ListGrid rows={rows} columns={historyColumns} rowId={(r) => r.run.id} href={runHref} />;
}
