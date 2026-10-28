"use client";

import { colorSchemeVariable, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CLASS_STYLE, OUTCOME_STYLE, type DisputeRow } from "@/lib/disputes-view";
import { relativeTime } from "@/lib/sessions-view";
import { checkPayPal, lookup } from "./actions";

import "@/lib/ag-grid";

const theme = themeQuartz
  .withPart(colorSchemeVariable)
  .withParams({ backgroundColor: "#ffffff", foregroundColor: "#171717" }, "light")
  .withParams({ backgroundColor: "#0a0a0a", foregroundColor: "#ededed" }, "dark");

const chip = (styles: Record<string, string>) =>
  function Chip({ value }: ICellRendererParams<DisputeRow, string>) {
    if (!value) return null;
    return <span className={`rounded px-2 py-0.5 text-xs ${styles[value] ?? "bg-black/10 dark:bg-white/10"}`}>{value}</span>;
  };

const columns: ColDef<DisputeRow>[] = [
  { headerName: "Updated", field: "updatedAt", valueFormatter: (p) => relativeTime(p.value, new Date()), width: 120 },
  {
    headerName: "Case",
    field: "id",
    cellRenderer: ({ value }: ICellRendererParams<DisputeRow, string>) => (
      <Link href={`/disputes/${encodeURIComponent(value ?? "")}`} className="underline">
        {value}
      </Link>
    ),
    minWidth: 190,
  },
  { headerName: "Reason", field: "reason", flex: 1, minWidth: 150 },
  { headerName: "Amount", field: "amount", width: 120 },
  { headerName: "Keel", field: "classification", cellRenderer: chip(CLASS_STYLE), width: 120 },
  { headerName: "Action", field: "action", flex: 1, minWidth: 160 },
  { headerName: "Outcome", field: "outcome", cellRenderer: chip(OUTCOME_STYLE), width: 120 },
];

export function DisputesGrid({ rows }: { rows: DisputeRow[] }) {
  // AG Grid follows data-ag-theme-mode; mirror the console's prefers-color-scheme.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.body.setAttribute("data-ag-theme-mode", mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const defaultColDef = useMemo<ColDef<DisputeRow>>(() => ({ sortable: true, resizable: true }), []);
  return (
    <div className="mt-4">
      <AgGridReact<DisputeRow> theme={theme} rowData={rows} columnDefs={columns} defaultColDef={defaultColDef} getRowId={(p) => p.data.id} domLayout="autoHeight" />
    </div>
  );
}

const btn = "rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

export function DisputeTools() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [caseId, setCaseId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const run = (fn: () => ReturnType<typeof checkPayPal>, done: string) => () => {
    setMessage(null);
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? done : r.message);
      if (r.ok) router.refresh();
    });
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button className={btn} disabled={pending} onClick={run(checkPayPal, "Checking PayPal…")}>
        Check PayPal now
      </button>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => lookup(caseId), "Looking it up…")();
        }}
      >
        <input
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          placeholder="PayPal case ID"
          maxLength={64}
          className="rounded border border-black/20 bg-transparent px-2 py-1 text-sm dark:border-white/20"
        />
        <button className={btn} disabled={pending || !caseId.trim()}>
          Look up
        </button>
      </form>
      {message && <span className="text-sm opacity-80">{message}</span>}
    </div>
  );
}
