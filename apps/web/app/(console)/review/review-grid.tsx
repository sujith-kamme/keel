"use client";

import { AllCommunityModule, ModuleRegistry, colorSchemeVariable, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ReleaseButton } from "@/components/release-button";
import { relativeTime } from "@/lib/sessions-view";
import type { ReviewRow } from "@/lib/review-view";
import { approve, deny } from "./actions";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz
  .withPart(colorSchemeVariable)
  .withParams({ backgroundColor: "#ffffff", foregroundColor: "#171717" }, "light")
  .withParams({ backgroundColor: "#0a0a0a", foregroundColor: "#ededed" }, "dark");

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
  return data.canRelease ? <ReleaseButton sessionId={data.sessionId} /> : null;
}

const columns: ColDef<ReviewRow>[] = [
  { headerName: "Created", field: "createdAt", valueFormatter: (p) => relativeTime(p.value, new Date()), width: 120 },
  { headerName: "Kind", field: "kindLabel", width: 120 },
  {
    headerName: "Session",
    field: "sessionId",
    cellRenderer: ({ value }: ICellRendererParams<ReviewRow, string>) => (
      <Link href={`/sessions/${encodeURIComponent(value)}`} className="underline">
        {value}
      </Link>
    ),
  },
  { headerName: "Tool", field: "tool", width: 140 },
  { headerName: "Amount / %", field: "amount", width: 120 },
  { headerName: "Reason codes", field: "reasons", flex: 1, minWidth: 160 },
  { headerName: "Risk score", field: "score", width: 110, valueFormatter: (p) => (p.value === null ? "n/a" : String(p.value)) },
  { headerName: "State", field: "state", width: 130 },
  { headerName: "Actions", cellRenderer: Actions, flex: 1, minWidth: 260, sortable: false },
];

export function ReviewGrid({ rows }: { rows: ReviewRow[] }) {
  // AG Grid follows data-ag-theme-mode; mirror the console's prefers-color-scheme.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.body.setAttribute("data-ag-theme-mode", mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const defaultColDef = useMemo<ColDef<ReviewRow>>(() => ({ sortable: true, resizable: true }), []);
  return (
    <div className="mt-4">
      <AgGridReact<ReviewRow> theme={theme} rowData={rows} columnDefs={columns} defaultColDef={defaultColDef} getRowId={(p) => p.data.id} domLayout="autoHeight" />
    </div>
  );
}
