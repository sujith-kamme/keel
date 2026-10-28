"use client";

import { colorSchemeVariable, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { outcomeStyle, type RunResult } from "@/lib/context-view";

import "@/lib/ag-grid";

const theme = themeQuartz
  .withPart(colorSchemeVariable)
  .withParams({ backgroundColor: "#ffffff", foregroundColor: "#171717" }, "light")
  .withParams({ backgroundColor: "#0a0a0a", foregroundColor: "#ededed" }, "dark");

const columns: ColDef<RunResult>[] = [
  { headerName: "Scenario", field: "scenario_id", flex: 1, minWidth: 180 },
  { headerName: "Pack", field: "pack", width: 160 },
  { headerName: "Kind", field: "kind", width: 110 },
  { headerName: "Repeat", field: "repeat", width: 90 },
  {
    headerName: "Outcome",
    field: "outcome",
    width: 150,
    cellRenderer: ({ value }: ICellRendererParams<RunResult, string>) => <span className={`rounded px-2 py-0.5 text-xs ${outcomeStyle(value ?? "")}`}>{value}</span>,
  },
  { headerName: "Triggered", field: "triggered", width: 110, valueFormatter: (p) => (p.value ? "yes" : "no") },
  { headerName: "Leaks", valueGetter: (p) => p.data?.leaks.join(", ") ?? "", width: 200 },
  { headerName: "Error", field: "error", flex: 1, minWidth: 160, valueFormatter: (p) => p.value ?? "" },
  {
    headerName: "Session",
    field: "session_id",
    width: 200,
    cellRenderer: ({ value }: ICellRendererParams<RunResult, string | null>) =>
      value ? (
        <Link href={`/sessions/${encodeURIComponent(value)}`} className="underline">
          {value}
        </Link>
      ) : null,
  },
];

export function ResultsGrid({ rows }: { rows: RunResult[] }) {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.body.setAttribute("data-ag-theme-mode", mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const defaultColDef = useMemo<ColDef<RunResult>>(() => ({ sortable: true, resizable: true }), []);
  return (
    <div className="mt-4">
      <AgGridReact<RunResult> theme={theme} rowData={rows} columnDefs={columns} defaultColDef={defaultColDef} getRowId={(p) => `${p.data.scenario_id}:${p.data.repeat}`} domLayout="autoHeight" />
    </div>
  );
}
