"use client";

import { type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { classTag, outcomeTag, type DisputeRow } from "@/lib/disputes-view";
import { relativeTime } from "@/lib/sessions-view";
import { checkPayPal, lookup } from "./actions";
import { useAgTheme } from "@/lib/ag-theme";

import "@/lib/ag-grid";

const detailHref = (id: string) => `/disputes/${encodeURIComponent(id)}`;
const ago = (p: { value?: string | null }) => (p.value ? relativeTime(p.value, new Date()) : "");

const columns: ColDef<DisputeRow>[] = [
  {
    headerName: "Case",
    field: "id",
    cellRenderer: ({ value }: ICellRendererParams<DisputeRow, string>) => (
      <Link href={detailHref(value ?? "")} className="mono" style={{ color: "var(--text)", fontWeight: 500 }}>
        {value}
      </Link>
    ),
    minWidth: 190,
  },
  { headerName: "Reason", field: "reason", filter: "agSetColumnFilter", flex: 1, minWidth: 150 },
  { headerName: "Amount", field: "amount", type: "rightAligned", width: 110 },
  {
    headerName: "Keel decided",
    field: "classification",
    filter: "agSetColumnFilter",
    width: 160,
    cellRenderer: ({ value }: ICellRendererParams<DisputeRow, string>) => {
      const t = classTag(value || null);
      return <span className={`bdg ${t.tone}`}>{t.label}</span>;
    },
  },
  { headerName: "Action taken", field: "action", filter: "agSetColumnFilter", flex: 1, minWidth: 160, cellClass: "mut" },
  {
    headerName: "Outcome",
    field: "outcome",
    filter: "agSetColumnFilter",
    width: 140,
    cellRenderer: ({ value }: ICellRendererParams<DisputeRow, string>) => {
      const t = outcomeTag(value ?? "");
      return <span className={`st ${t.tone}`}>{t.label}</span>;
    },
  },
  // When Keel first synced the dispute, within minutes of PayPal opening it.
  { headerName: "First seen", field: "createdAt", type: "rightAligned", valueFormatter: ago, width: 120 },
  { headerName: "Updated", field: "updatedAt", type: "rightAligned", valueFormatter: ago, width: 120 },
];

export function DisputesGrid({ rows, note }: { rows: DisputeRow[]; note: string }) {
  const router = useRouter();
  const { grid } = useAgTheme();
  const theme = useMemo(() => grid.withParams({ wrapperBorder: false, wrapperBorderRadius: 0 }), [grid]);
  const defaultColDef = useMemo<ColDef<DisputeRow>>(() => ({ sortable: true, resizable: true }), []);
  return (
    <section className="pnl" style={{ minWidth: 0 }}>
      <AgGridReact<DisputeRow>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        getRowId={(p) => p.data.id}
        domLayout="autoHeight"
        rowStyle={{ cursor: "pointer" }}
        onRowClicked={(e) => e.data && router.push(detailHref(e.data.id))}
      />
      <div className="tfoot">
        <span>
          {rows.length} {rows.length === 1 ? "dispute" : "disputes"}
        </span>
        <span>{note}</span>
      </div>
    </section>
  );
}

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
    <>
      {message && <span className="sm mut">{message}</span>}
      <form
        className="acts"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => lookup(caseId), "Looking it up…")();
        }}
      >
        <input
          className="in"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          placeholder="PayPal case ID"
          aria-label="PayPal case ID"
          maxLength={64}
          style={{ width: 200 }}
        />
        <button className="b" disabled={pending || !caseId.trim()}>
          Look up
        </button>
      </form>
      <button className="b" disabled={pending} onClick={run(checkPayPal, "Syncing with PayPal…")}>
        <i className="ic ic-sync s14" aria-hidden="true" />
        Sync now
      </button>
    </>
  );
}
