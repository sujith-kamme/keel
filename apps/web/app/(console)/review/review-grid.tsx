"use client";

import { type ColDef, type GridApi, type ICellRendererParams, type StructuredSchemaParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AddToGauntlet } from "@/components/add-to-gauntlet";
import { AskGrid } from "@/components/ask-grid";
import { ReleaseButton } from "@/components/release-button";
import { amountValue } from "@/lib/ledger-view";
import { relativeTime } from "@/lib/sessions-view";
import type { ReviewRow } from "@/lib/review-view";
import { approve, deny } from "./actions";
import { useAgTheme } from "@/lib/ag-theme";

import "@/lib/ag-grid";

function HeldActions({ row }: { row: ReviewRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (label: string, fn: (id: string) => ReturnType<typeof approve>) => () => {
    if (!row.decisionId || !window.confirm(`${label} this ${row.tool} ${row.amount}?`)) return;
    setError(null);
    start(async () => {
      const r = await fn(row.decisionId as string);
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  };
  const btn = "rounded border border-black/20 px-2 py-0.5 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";
  return (
    <span className="inline-flex items-center gap-2">
      <button className={btn} disabled={pending} onClick={run("Approve", approve)}>
        Approve
      </button>
      <button className={btn} disabled={pending} onClick={run("Deny", deny)}>
        Deny
      </button>
      {error && <span className="text-xs text-red-700 dark:text-red-300">{error}</span>}
    </span>
  );
}

function Actions({ data }: ICellRendererParams<ReviewRow>) {
  if (!data) return null;
  if (data.kind === "held_action") return <HeldActions row={data} />;
  return (
    <span className="inline-flex items-center gap-2">
      {data.canRelease && <ReleaseButton sessionId={data.sessionId} />}
      <AddToGauntlet sessionId={data.sessionId} />
    </span>
  );
}

const set = { filter: "agSetColumnFilter", enableRowGroup: true } as const;

const columns: ColDef<ReviewRow>[] = [
  { headerName: "Created", field: "createdAt", valueFormatter: (p) => relativeTime(p.value, new Date()), width: 120 },
  { headerName: "Kind", field: "kindLabel", ...set, width: 120 },
  {
    headerName: "Session",
    field: "sessionId",
    cellRenderer: ({ value }: ICellRendererParams<ReviewRow, string>) => (
      <Link href={`/sessions/${encodeURIComponent(value ?? "")}`} className="underline">
        {value}
      </Link>
    ),
  },
  { headerName: "Tool", field: "tool", ...set, width: 140 },
  {
    headerName: "Amount / %",
    colId: "amount",
    // A number for the filter and sort; percent (discount) rows have no amount.
    valueGetter: (p) => (p.data ? amountValue(p.data.amount) : null),
    valueFormatter: (p) => p.data?.amount ?? "",
    filter: "agNumberColumnFilter",
    width: 120,
  },
  { headerName: "Reason codes", field: "reasons", ...set, flex: 1, minWidth: 160 },
  {
    headerName: "Risk score",
    field: "score",
    filter: "agNumberColumnFilter",
    width: 110,
    valueFormatter: (p) => (p.value === null ? "n/a" : String(p.value)),
  },
  { headerName: "State", field: "state", ...set, width: 130 },
  { headerName: "Actions", cellRenderer: Actions, flex: 1, minWidth: 260, sortable: false },
];

const ASK_EXAMPLES = ["refunds over $50 grouped by reason code", "quarantined sessions only", "oldest first"];
const ASK_SCHEMA: StructuredSchemaParams = {
  columns: {
    kindLabel: { includeSetValues: true },
    tool: { includeSetValues: true },
    reasons: { includeSetValues: true, description: "Reason codes, comma-separated" },
    state: { includeSetValues: true, description: "Session state" },
    amount: { description: "Refund amount in dollars; empty for percent discounts" },
    createdAt: { description: "When it was created (ISO time)" },
  },
};

export function ReviewGrid({ rows }: { rows: ReviewRow[] }) {
  const { grid } = useAgTheme();
  const defaultColDef = useMemo<ColDef<ReviewRow>>(() => ({ sortable: true, resizable: true }), []);
  const [api, setApi] = useState<GridApi<ReviewRow> | null>(null);
  return (
    <div className="mt-4">
      <AskGrid api={api} examples={ASK_EXAMPLES} schemaParams={ASK_SCHEMA} />
      <div className="mt-3">
        <AgGridReact<ReviewRow>
          theme={grid}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.id}
          domLayout="autoHeight"
          onGridReady={(e) => setApi(e.api)}
        />
      </div>
    </div>
  );
}
