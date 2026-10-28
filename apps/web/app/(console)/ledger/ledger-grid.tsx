"use client";

import { colorSchemeVariable, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { VERDICT_STYLE, amountValue, chainMessage, type ChainResult, type LedgerPage, type LedgerRow } from "@/lib/ledger-view";
import { loadOlder, verify } from "./actions";

import "@/lib/ag-grid";

const theme = themeQuartz
  .withPart(colorSchemeVariable)
  .withParams({ backgroundColor: "#ffffff", foregroundColor: "#171717" }, "light")
  .withParams({ backgroundColor: "#0a0a0a", foregroundColor: "#ededed" }, "dark");

const link = (base: string) =>
  function IdLink({ value }: ICellRendererParams<LedgerRow, string | null>) {
    if (!value) return null;
    return (
      <Link href={`/${base}/${encodeURIComponent(value)}`} className="underline">
        {value}
      </Link>
    );
  };

function Verdict({ value }: ICellRendererParams<LedgerRow, string>) {
  if (!value) return null;
  return <span className={`rounded px-2 py-0.5 text-xs ${VERDICT_STYLE[value] ?? "bg-black/10 dark:bg-white/10"}`}>{value}</span>;
}

function Payload({ data }: ICellRendererParams<LedgerRow>) {
  return <pre className="overflow-x-auto p-4 text-xs">{JSON.stringify(data?.payload, null, 2)}</pre>;
}

const set = { filter: "agSetColumnFilter", enableRowGroup: true } as const;

const columns: ColDef<LedgerRow>[] = [
  { headerName: "Seq", field: "seq", cellRenderer: "agGroupCellRenderer", filter: "agNumberColumnFilter", width: 120 },
  {
    headerName: "Created",
    colId: "created_at",
    valueGetter: (p) => (p.data ? new Date(p.data.created_at) : null),
    valueFormatter: (p) => (p.value ? (p.value as Date).toLocaleString() : ""),
    filter: "agDateColumnFilter",
    cellDataType: "date",
    width: 190,
  },
  { headerName: "Verdict", field: "verdict", cellRenderer: Verdict, ...set, width: 120 },
  { headerName: "Tool", field: "tool", ...set, width: 150 },
  {
    headerName: "Reason codes",
    field: "reason_codes",
    valueFormatter: (p) => (Array.isArray(p.value) ? p.value.join(", ") : String(p.value ?? "")),
    filter: "agSetColumnFilter",
    flex: 1,
    minWidth: 180,
  },
  {
    headerName: "Amount",
    colId: "amount",
    valueGetter: (p) => (p.data ? amountValue(p.data.amount) : null),
    filter: "agNumberColumnFilter",
    cellDataType: "number",
    enableValue: true,
    width: 110,
  },
  { headerName: "Session", field: "session_id", cellRenderer: link("sessions"), filter: "agTextColumnFilter", minWidth: 160 },
  { headerName: "Order", field: "order_id", filter: "agTextColumnFilter", width: 130 },
  { headerName: "Dispute", field: "dispute_id", cellRenderer: link("disputes"), filter: "agTextColumnFilter", minWidth: 160 },
  { headerName: "Mode", field: "mode", ...set, width: 110 },
  { headerName: "Hash", field: "hash", valueFormatter: (p) => (p.value ? `${String(p.value).slice(0, 12)}…` : ""), width: 140 },
];

const btn = "rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

export function LedgerGrid({ initial }: { initial: LedgerPage }) {
  // AG Grid follows data-ag-theme-mode; mirror the console's prefers-color-scheme.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.body.setAttribute("data-ag-theme-mode", mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const gridRef = useRef<AgGridReact<LedgerRow>>(null);
  const [rows, setRows] = useState(initial.rows);
  const [next, setNext] = useState(initial.next_before_seq);
  const [chain, setChain] = useState<ChainResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const defaultColDef = useMemo<ColDef<LedgerRow>>(() => ({ sortable: true, resizable: true }), []);

  const runVerify = () => {
    setMessage(null);
    start(async () => {
      const r = await verify();
      if (r.ok) setChain(r.data);
      else setMessage(r.message);
    });
  };
  const runOlder = () => {
    if (next === null) return;
    setMessage(null);
    start(async () => {
      const r = await loadOlder(next);
      if (!r.ok) return setMessage(r.message);
      setRows((prev) => [...prev, ...r.data.rows]);
      setNext(r.data.next_before_seq);
    });
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: "keel-ledger.csv" })}>
          Export CSV
        </button>
        <a className={btn} href="/ledger/export">
          Export JSON
        </a>
        <button className={btn} disabled={pending} onClick={runVerify}>
          Verify chain
        </button>
        <button className={btn} disabled={pending || next === null} onClick={runOlder}>
          Load older
        </button>
        <span className="text-sm opacity-70">{rows.length.toLocaleString("en-US")} rows loaded</span>
        {message && <span className="text-sm text-red-700 dark:text-red-300">{message}</span>}
      </div>
      {chain && (
        <p
          className={`mt-3 rounded px-3 py-2 text-sm ${chain.ok ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"}`}
        >
          {chainMessage(chain)}
        </p>
      )}
      <div className="mt-3" style={{ height: 640 }}>
        <AgGridReact<LedgerRow>
          ref={gridRef}
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          getRowId={(p) => String(p.data.seq)}
          rowGroupPanelShow="always"
          masterDetail
          detailCellRenderer={Payload}
          detailRowAutoHeight
        />
      </div>
    </div>
  );
}
