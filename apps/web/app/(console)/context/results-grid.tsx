"use client";

import { type ColDef, type GridApi, type ICellRendererParams, type StructuredSchemaParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AskGrid } from "@/components/ask-grid";
import { outcomeStyle, type RunResult } from "@/lib/context-view";
import { useAgTheme } from "@/lib/ag-theme";

import "@/lib/ag-grid";

const set = { filter: "agSetColumnFilter", enableRowGroup: true } as const;

const columns: ColDef<RunResult>[] = [
  { headerName: "Scenario", field: "scenario_id", filter: "agTextColumnFilter", flex: 1, minWidth: 180 },
  { headerName: "Pack", field: "pack", ...set, width: 160 },
  { headerName: "Kind", field: "kind", ...set, width: 110 },
  { headerName: "Repeat", field: "repeat", width: 90 },
  {
    headerName: "Outcome",
    field: "outcome",
    ...set,
    width: 150,
    cellRenderer: ({ value }: ICellRendererParams<RunResult, string>) => <span className={`rounded px-2 py-0.5 text-xs ${outcomeStyle(value ?? "")}`}>{value}</span>,
  },
  { headerName: "Triggered", field: "triggered", ...set, width: 110, valueFormatter: (p) => (p.value ? "yes" : "no") },
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

const ASK_EXAMPLES = ["leaks grouped by scenario pack", "failed scenarios only", "triggered scenarios grouped by kind"];
const ASK_SCHEMA: StructuredSchemaParams = {
  columns: {
    pack: { includeSetValues: true, description: "Scenario pack" },
    kind: { includeSetValues: true },
    outcome: { includeSetValues: true, description: "PASS, or how the scenario failed: LEAK, FALSE_POSITIVE or ERROR" },
    triggered: { includeSetValues: true, description: "Whether Keel stepped in" },
  },
};

export function ResultsGrid({ rows }: { rows: RunResult[] }) {
  const { grid } = useAgTheme();
  const defaultColDef = useMemo<ColDef<RunResult>>(() => ({ sortable: true, resizable: true }), []);
  const [api, setApi] = useState<GridApi<RunResult> | null>(null);
  return (
    <div className="mt-4">
      <AskGrid api={api} examples={ASK_EXAMPLES} schemaParams={ASK_SCHEMA} />
      <div className="mt-3">
        <AgGridReact<RunResult>
          theme={grid}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          getRowId={(p) => `${p.data.scenario_id}:${p.data.repeat}`}
          domLayout="autoHeight"
          onGridReady={(e) => setApi(e.api)}
        />
      </div>
    </div>
  );
}
