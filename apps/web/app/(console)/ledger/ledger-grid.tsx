"use client";

import { type ColDef, type GridApi, type ICellRendererParams, type IRowNode, type StructuredSchemaParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { AskGrid } from "@/components/ask-grid";
import { type ReactNode, useCallback, useMemo, useRef, useState, useTransition } from "react";
import { amountValue, chainMessage, inRange, shortHash, utcStamp, type ChainResult, type LedgerPage, type LedgerRow, type Range } from "@/lib/ledger-view";
import { decision } from "@/lib/overview-view";
import { loadOlder, verify } from "./actions";
import { useAgTheme } from "@/lib/ag-theme";

import "@/lib/ag-grid";

const n = (x: number) => x.toLocaleString("en-US");

const link = (base: string) =>
  function IdLink({ value }: ICellRendererParams<LedgerRow, string | null>) {
    if (!value) return <span className="dim">—</span>;
    return (
      <Link href={`/${base}/${encodeURIComponent(value)}`} className="mono">
        {value}
      </Link>
    );
  };

function SeqLink({ value }: ICellRendererParams<LedgerRow, number>) {
  return (
    <Link href={`/ledger/${value}`} className="mono">
      {value}
    </Link>
  );
}

function Verdict({ value }: ICellRendererParams<LedgerRow, string>) {
  if (!value) return null;
  const v = decision(value);
  return <span className={`st ${v.tone}`}>{v.label}</span>;
}

function Payload({ data }: ICellRendererParams<LedgerRow>) {
  return (
    <pre className="mono" style={{ margin: 0, padding: "14px 16px", overflowX: "auto", fontSize: 12, lineHeight: "18px" }}>
      {JSON.stringify(data?.payload, null, 2)}
    </pre>
  );
}

const set = { filter: "agSetColumnFilter", enableRowGroup: true } as const;

const columns: ColDef<LedgerRow>[] = [
  // The group renderer gives the master-detail chevron; the seq itself opens the entry page.
  { headerName: "Seq", field: "seq", cellRenderer: "agGroupCellRenderer", cellRendererParams: { innerRenderer: SeqLink }, filter: "agNumberColumnFilter", width: 120 },
  {
    headerName: "Time (UTC)",
    colId: "created_at",
    valueGetter: (p) => (p.data ? new Date(p.data.created_at) : null),
    valueFormatter: (p) => (p.data ? utcStamp(p.data.created_at) : ""),
    filter: "agDateColumnFilter",
    cellDataType: "date",
    cellClass: "mono",
    width: 170,
  },
  { headerName: "Verdict", field: "verdict", cellRenderer: Verdict, ...set, width: 120 },
  { headerName: "Tool", field: "tool", ...set, cellClass: "mono", width: 160 },
  {
    headerName: "Reason",
    field: "reason_codes",
    valueFormatter: (p) => (Array.isArray(p.value) ? p.value.join(", ") : String(p.value ?? "")),
    ...set,
    cellClass: "mono",
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
    type: "rightAligned",
    width: 110,
  },
  { headerName: "Session", field: "session_id", cellRenderer: link("sessions"), filter: "agTextColumnFilter", minWidth: 160 },
  { headerName: "Order", field: "order_id", filter: "agTextColumnFilter", cellClass: "mono", width: 150 },
  { headerName: "Dispute", field: "dispute_id", cellRenderer: link("disputes"), filter: "agTextColumnFilter", minWidth: 160 },
  { headerName: "Mode", field: "mode", ...set, width: 110 },
  { headerName: "Hash", field: "hash", valueFormatter: (p) => (p.value ? shortHash(String(p.value)) : ""), cellClass: "mono", width: 120 },
];

const ASK_EXAMPLES = ["held refunds over $50 grouped by reason code", "blocked decisions this week, newest first", "dispute decisions only"];
const ASK_SCHEMA: StructuredSchemaParams = {
  columns: {
    verdict: { includeSetValues: true },
    tool: { includeSetValues: true, description: "dispute is Keel's decision on a PayPal dispute (ALLOW conceded, BLOCK defended, HOLD left for review); dispute_action is an operator submitting evidence or accepting a claim" },
    reason_codes: { includeSetValues: true },
    mode: { includeSetValues: true },
    amount: { description: "Refund amount in dollars" },
  },
};
const ASK_FILTERS = ["created_at", "verdict", "tool", "reason_codes", "amount", "mode"];

const RANGES: { id: Range; label: string }[] = [
  { id: "1h", label: "1h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "all", label: "All" },
];

export function LedgerHeader({ children }: { children?: ReactNode }) {
  return (
    <div className="ph">
      <div>
        <h1>Ledger</h1>
        <p>Append-only record of every decision. Each entry hashes the one before it.</p>
      </div>
      {children && <div className="acts">{children}</div>}
    </div>
  );
}

export function LedgerGrid({ initial }: { initial: LedgerPage }) {
  const { grid } = useAgTheme();
  const theme = useMemo(() => grid.withParams({ wrapperBorder: false, wrapperBorderRadius: 0 }), [grid]);
  const gridRef = useRef<AgGridReact<LedgerRow>>(null);
  const [api, setApi] = useState<GridApi<LedgerRow> | null>(null);
  const [rows, setRows] = useState(initial.rows);
  const [next, setNext] = useState(initial.next_before_seq);
  const [chain, setChain] = useState<ChainResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("all");
  const rangeRef = useRef<Range>("all");
  const [pending, start] = useTransition();
  const defaultColDef = useMemo<ColDef<LedgerRow>>(() => ({ sortable: true, resizable: true }), []);

  const pickRange = (r: Range) => {
    rangeRef.current = r;
    setRange(r);
    api?.onFilterChanged();
  };
  const isExternalFilterPresent = useCallback(() => rangeRef.current !== "all", []);
  const doesExternalFilterPass = useCallback((node: IRowNode<LedgerRow>) => !node.data || inRange(node.data.created_at, rangeRef.current, new Date()), []);

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
    <>
      <LedgerHeader>
        {chain && <span className={`st ${chain.ok ? "ok" : "bad"}`}>{chain.ok ? `Chain verified · ${n(chain.count)} entries` : chainMessage(chain)}</span>}
        {message && (
          <span className="sm" style={{ color: "var(--bad)" }}>
            {message}
          </span>
        )}
        <button className="b" disabled={pending} onClick={runVerify}>
          <i className="ic ic-shield s14" aria-hidden="true" />
          Verify chain
        </button>
        <button className="b" onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: "keel-ledger.csv" })}>
          <i className="ic ic-export s14" aria-hidden="true" />
          Export CSV
        </button>
        <a className="b" href="/ledger/export">
          <i className="ic ic-export s14" aria-hidden="true" />
          Export JSON
        </a>
      </LedgerHeader>

      <section className="pnl" style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "0 16px 12px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <AskGrid api={api} examples={ASK_EXAMPLES} schemaParams={ASK_SCHEMA} filterColumns={ASK_FILTERS} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
            <div className="segc" role="group" aria-label="Time range over the loaded entries">
              {RANGES.map((r) => (
                <button key={r.id} type="button" className={range === r.id ? "on" : undefined} aria-pressed={range === r.id} onClick={() => pickRange(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
            <span className="sm dim">of loaded entries</span>
          </div>
        </div>
        <div style={{ height: 640 }}>
          <AgGridReact<LedgerRow>
            ref={gridRef}
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={defaultColDef}
            getRowId={(p) => String(p.data.seq)}
            onGridReady={(e) => setApi(e.api)}
            isExternalFilterPresent={isExternalFilterPresent}
            doesExternalFilterPass={doesExternalFilterPass}
            rowGroupPanelShow="always"
            masterDetail
            detailCellRenderer={Payload}
            detailRowAutoHeight
          />
        </div>
        <div className="tfoot">
          <span>
            {n(rows.length)} of {n(initial.total)} entries loaded · newest first
          </span>
          <span className="acts">
            <button className="b xs" disabled={pending || next === null} onClick={runOlder}>
              Older
            </button>
          </span>
        </div>
      </section>
    </>
  );
}
