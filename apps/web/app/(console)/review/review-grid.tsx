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
import { amountText, type ReviewRow, type ReviewTab } from "@/lib/review-view";
import { approve, deny } from "./actions";
import { useAgTheme } from "@/lib/ag-theme";

import "@/lib/ag-grid";

function HeldActions({ row }: { row: ReviewRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (label: string, fn: (id: string) => ReturnType<typeof approve>) => () => {
    if (!row.decisionId || !window.confirm(`${label} this ${row.action.toLowerCase()} ${amountText(row.amount)}?`)) return;
    setError(null);
    start(async () => {
      const r = await fn(row.decisionId as string);
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  };
  return (
    <span className="acts" style={{ flexWrap: "nowrap", height: "100%" }}>
      <button className="b xs" disabled={pending} onClick={run("Deny", deny)}>
        Deny
      </button>
      <button className="b xs pri" disabled={pending} onClick={run("Approve", approve)}>
        Approve
      </button>
      {error && (
        <span className="sm" style={{ color: "var(--bad)" }}>
          {error}
        </span>
      )}
    </span>
  );
}

function Actions({ data }: ICellRendererParams<ReviewRow>) {
  if (!data) return null;
  if (data.kind === "held_action") return <HeldActions row={data} />;
  return (
    <span className="acts" style={{ flexWrap: "nowrap", height: "100%" }}>
      {data.canRelease && <ReleaseButton sessionId={data.sessionId} />}
      <AddToGauntlet sessionId={data.sessionId} />
    </span>
  );
}

const itemHref = (r: ReviewRow) => (r.decisionId ? `/review/${encodeURIComponent(r.decisionId)}` : `/sessions/${encodeURIComponent(r.sessionId)}`);
const set = { filter: "agSetColumnFilter", enableRowGroup: true } as const;

const columns: ColDef<ReviewRow>[] = [
  {
    headerName: "Action",
    field: "action",
    ...set,
    width: 170,
    cellRenderer: ({ data, value }: ICellRendererParams<ReviewRow, string>) =>
      data ? (
        <Link href={itemHref(data)} style={{ color: "var(--text)", fontWeight: 500 }}>
          {value}
        </Link>
      ) : (
        value
      ),
  },
  {
    headerName: "Amount",
    colId: "amount",
    // A number for the filter and sort; percent (discount) rows have no amount.
    valueGetter: (p) => (p.data ? amountValue(p.data.amount) : null),
    valueFormatter: (p) => (p.data ? amountText(p.data.amount) : ""),
    filter: "agNumberColumnFilter",
    type: "rightAligned",
    width: 120,
  },
  { headerName: "Order", field: "order", cellClass: "mono", width: 150, valueFormatter: (p) => p.value || "—" },
  { headerName: "Held because", field: "reasons", ...set, flex: 1, minWidth: 180 },
  {
    headerName: "Conversation",
    field: "sessionId",
    width: 160,
    cellRenderer: ({ value }: ICellRendererParams<ReviewRow, string>) => (
      <Link href={`/sessions/${encodeURIComponent(value ?? "")}`} className="mono">
        {value}
      </Link>
    ),
  },
  // Held actions carry the time Keel held them; flagged sessions only their start time.
  { headerName: "Waiting", colId: "createdAt", field: "createdAt", type: "rightAligned", valueFormatter: (p) => relativeTime(p.value, new Date()), width: 120, sort: "asc" },
  { headerName: "Decide", cellRenderer: Actions, width: 200, sortable: false },
];

const ASK_EXAMPLES = ["refunds over $50", "group by reason", "newest first"];
const ASK_SCHEMA: StructuredSchemaParams = {
  columns: {
    action: { includeSetValues: true, description: "Refund or Discount for held actions; the state for flagged conversations" },
    reasons: { includeSetValues: true, description: "Why Keel held it, comma-separated" },
    amount: { description: "Refund amount in dollars; empty for percent discounts" },
    createdAt: { description: "When it was held (ISO time)" },
  },
};

const TABS: { id: ReviewTab; label: string; noun: [string, string] }[] = [
  { id: "held", label: "Held actions", noun: ["held action", "held actions"] },
  { id: "quarantined", label: "Quarantined conversations", noun: ["quarantined conversation", "quarantined conversations"] },
  { id: "escalated", label: "Escalated", noun: ["escalated conversation", "escalated conversations"] },
];

export function ReviewGrid({ rows }: { rows: ReviewRow[] }) {
  const { grid } = useAgTheme();
  const theme = useMemo(() => grid.withParams({ wrapperBorder: false, wrapperBorderRadius: 0 }), [grid]);
  const defaultColDef = useMemo<ColDef<ReviewRow>>(() => ({ sortable: true, resizable: true }), []);
  const [api, setApi] = useState<GridApi<ReviewRow> | null>(null);
  const [tab, setTab] = useState<ReviewTab>("held");
  const shown = rows.filter((r) => r.tab === tab);
  const columnDefs = useMemo(() => (tab === "held" ? columns : columns.map((c) => (c.colId === "createdAt" ? { ...c, headerName: "Started" } : c))), [tab]);
  const noun = TABS.find((t) => t.id === tab)!.noun[shown.length === 1 ? 0 : 1];
  const oldest = tab === "held" ? shown.map((r) => r.createdAt).sort()[0] : undefined;
  return (
    <>
      <div className="tabsu" role="tablist" aria-label="Queue">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
            <span className="n">{rows.filter((r) => r.tab === t.id).length}</span>
          </button>
        ))}
      </div>
      <section className="pnl" style={{ minWidth: 0 }}>
        <div style={{ padding: "0 16px 12px", borderBottom: "1px solid var(--line)" }}>
          <AskGrid api={api} examples={ASK_EXAMPLES} schemaParams={ASK_SCHEMA} />
        </div>
        <div style={{ height: 640 }}>
          <AgGridReact<ReviewRow>
            theme={theme}
            rowData={shown}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={(p) => p.data.id}
            onGridReady={(e) => setApi(e.api)}
          />
        </div>
        <div className="tfoot">
          <span>
            {shown.length} {noun}
            {oldest && ` · oldest held ${relativeTime(oldest, new Date())}`}
          </span>
          <span>Open a held action to see why it was held</span>
        </div>
      </section>
    </>
  );
}
