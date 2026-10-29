"use client";

import { type ColDef, type GridApi, type ICellRendererParams, type StructuredSchemaParams, type ValueFormatterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AskGrid } from "@/components/ask-grid";
import { outcomeBadge, packLabel, type RunResult } from "@/lib/context-view";
import { useAgTheme } from "@/lib/ag-theme";

import "@/lib/ag-grid";

const set = { filter: "agSetColumnFilter", enableRowGroup: true } as const;
const packFmt = (p: ValueFormatterParams) => packLabel(String(p.value ?? ""));
const outcomeFmt = (p: ValueFormatterParams) => outcomeBadge(String(p.value ?? "")).label;

const columns: ColDef<RunResult>[] = [
  { headerName: "Scenario", field: "scenario_id", filter: "agTextColumnFilter", flex: 1, minWidth: 180 },
  { headerName: "Pack", field: "pack", ...set, width: 180, valueFormatter: packFmt, filterParams: { valueFormatter: packFmt } },
  { headerName: "Kind", field: "kind", ...set, width: 120 },
  { headerName: "Repeat", field: "repeat", width: 110, type: "rightAligned" },
  // Honest scenarios always report triggered; only attack scenarios say whether Keel acted.
  { headerName: "Triggered", colId: "triggered", ...set, width: 120, valueGetter: (p) => (p.data?.kind === "honest" ? "—" : p.data?.triggered ? "yes" : "no") },
  {
    headerName: "Outcome",
    field: "outcome",
    ...set,
    width: 150,
    filterParams: { valueFormatter: outcomeFmt },
    cellRenderer: ({ value }: ICellRendererParams<RunResult, string>) => {
      const o = outcomeBadge(value ?? "");
      return <span className={`st ${o.tone}`}>{o.label}</span>;
    },
  },
  { headerName: "Leaks", valueGetter: (p) => p.data?.leaks.join(", ") ?? "", width: 200 },
  { headerName: "Error", field: "error", flex: 1, minWidth: 160, valueFormatter: (p) => p.value ?? "" },
  {
    headerName: "Transcript",
    field: "session_id",
    width: 120,
    cellRenderer: ({ value }: ICellRendererParams<RunResult, string | null>) =>
      value ? (
        <Link href={`/sessions/${encodeURIComponent(value)}`} title={value}>
          Transcript
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
    triggered: { includeSetValues: true, description: "Whether Keel stepped in on an attack: yes or no; — for honest scenarios" },
  },
};

/** A one-value set filter on `col`, or none; also what the select shows. A set filter holding every value is no filter. */
function useOneValueFilter(api: GridApi<RunResult> | null, col: string) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!api) return;
    const sync = () => {
      const values = (api.getColumnFilterModel(col) as { values?: string[] } | null)?.values;
      setValue(values?.length === 1 ? values[0]! : "");
    };
    api.addEventListener("filterChanged", sync);
    // Switching tabs unmounts the grid first; a destroyed grid has no listeners to remove.
    return () => {
      if (!api.isDestroyed()) api.removeEventListener("filterChanged", sync);
    };
  }, [api, col]);
  const pick = (v: string) => {
    if (!api) return;
    api.setFilterModel({ ...api.getFilterModel(), [col]: v ? { filterType: "set", values: [v] } : null });
  };
  return [value, pick] as const;
}

export function ResultsGrid({ rows }: { rows: RunResult[] }) {
  const { grid } = useAgTheme();
  const theme = useMemo(() => grid.withParams({ wrapperBorder: false, wrapperBorderRadius: 0 }), [grid]);
  const defaultColDef = useMemo<ColDef<RunResult>>(() => ({ sortable: true, resizable: true }), []);
  const [api, setApi] = useState<GridApi<RunResult> | null>(null);
  const [outcome, pickOutcome] = useOneValueFilter(api, "outcome");
  const [pack, pickPack] = useOneValueFilter(api, "pack");
  const outcomes = [...new Set(rows.map((r) => r.outcome))].sort();
  const packs = [...new Set(rows.map((r) => r.pack))].sort((a, b) => packLabel(a).localeCompare(packLabel(b)));
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "0 16px 12px", borderBottom: "1px solid var(--line)" }}>
        <AskGrid api={api} examples={ASK_EXAMPLES} schemaParams={ASK_SCHEMA} />
        <span className="acts" style={{ marginTop: 16, marginLeft: "auto" }}>
          <select className="sel" aria-label="Filter by outcome" value={outcome} onChange={(e) => pickOutcome(e.target.value)} disabled={!api}>
            <option value="">All outcomes</option>
            {outcomes.map((o) => (
              <option key={o} value={o}>
                {outcomeBadge(o).label}
              </option>
            ))}
          </select>
          <select className="sel" aria-label="Filter by pack" value={pack} onChange={(e) => pickPack(e.target.value)} disabled={!api}>
            <option value="">All packs</option>
            {packs.map((p) => (
              <option key={p} value={p}>
                {packLabel(p)}
              </option>
            ))}
          </select>
        </span>
      </div>
      <AgGridReact<RunResult>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        getRowId={(p) => `${p.data.scenario_id}:${p.data.repeat}`}
        domLayout="autoHeight"
        onGridReady={(e) => setApi(e.api)}
      />
    </>
  );
}
