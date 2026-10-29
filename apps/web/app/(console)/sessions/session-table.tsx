"use client";

import { type ColDef, type ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ListGrid } from "@/components/list-grid";
import { matchesSearch, SESSION_STATES, sessionState, sessionsHref } from "@/lib/sessions-view";

export interface SessionListRow {
  id: string;
  email: string;
  verified: boolean;
  agentId: string;
  orderIds: string[];
  state: string;
  risk: number | null;
  decisions: number;
  lastTurn: string | null;
}

const href = (r: SessionListRow) => `/sessions/${encodeURIComponent(r.id)}`;

const columns: ColDef<SessionListRow>[] = [
  {
    headerName: "Customer",
    field: "email",
    flex: 1,
    minWidth: 220,
    cellRenderer: ({ data, value }: ICellRendererParams<SessionListRow, string>) =>
      data ? (
        <>
          <Link href={href(data)} style={{ color: "var(--text)", fontWeight: 500 }}>
            {value}
          </Link>
          {!data.verified && <span className="sm dim"> · not verified</span>}
        </>
      ) : null,
  },
  { headerName: "Agent", field: "agentId", width: 170, cellClass: "mono mut" },
  {
    headerName: "Order",
    colId: "order",
    width: 160,
    cellClass: "mono mut",
    valueGetter: (p) => p.data?.orderIds[0] ?? "—",
    valueFormatter: (p) => (p.data && p.data.orderIds.length > 1 ? `${p.value} +${p.data.orderIds.length - 1}` : p.value),
    tooltipValueGetter: (p) => p.data?.orderIds.join(", "),
  },
  {
    headerName: "State",
    field: "state",
    width: 140,
    cellRenderer: ({ value }: ICellRendererParams<SessionListRow, string>) => {
      const st = sessionState(value ?? "");
      return <span className={`st ${st.tone}`}>{st.label}</span>;
    },
  },
  { headerName: "Risk", field: "risk", width: 90, type: "rightAligned", cellClass: "mono", valueFormatter: (p) => (p.value === null ? "—" : String(p.value)) },
  { headerName: "Decisions", field: "decisions", width: 110, type: "rightAligned" },
  // Already relative ("2 min ago"), so it keeps the served order: newest first.
  { headerName: "Last turn", field: "lastTurn", width: 130, type: "rightAligned", cellClass: "mut", sortable: false, valueFormatter: (p) => p.value ?? "—" },
];

/** One page of conversations: state tabs (server-filtered), a search over the loaded page, and cursor paging. */
export function SessionTable({ rows, state, previous, next }: { rows: SessionListRow[]; state: string | null; previous: string | null; next: string | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const shown = rows.filter((r) => matchesSearch({ claimed_email: r.email, id: r.id, order_ids: r.orderIds }, query));
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
        <div className="tabsu" role="tablist" aria-label="State" style={{ borderBottom: 0 }}>
          {[null, ...SESSION_STATES].map((s) => (
            <button key={s ?? "all"} type="button" role="tab" aria-selected={state === s} className={state === s ? "on" : undefined} onClick={() => router.push(sessionsHref(s, []))}>
              {s === null ? "All" : sessionState(s).label}
            </button>
          ))}
        </div>
        <input
          className="in"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter this page by email or order"
          aria-label="Filter conversations on this page"
          style={{ width: 320, maxWidth: "100%", marginLeft: "auto", marginBottom: 6 }}
        />
      </div>
      <section className="pnl" style={{ minWidth: 0 }}>
        <ListGrid rows={shown} columns={columns} rowId={(r) => r.id} href={href} empty={rows.length === 0 ? "No conversations here." : "No conversation on this page matches."} />
        <div className="tfoot">
          <span>
            {query.trim() ? `${shown.length} of ${rows.length}` : rows.length} {rows.length === 1 ? "conversation" : "conversations"} on this page
          </span>
          <span className="acts">
            {previous ? (
              <Link className="b xs" href={previous}>
                Previous
              </Link>
            ) : (
              <button className="b xs" disabled>
                Previous
              </button>
            )}
            {next ? (
              <Link className="b xs" href={next}>
                Next
              </Link>
            ) : (
              <button className="b xs" disabled>
                Next
              </button>
            )}
          </span>
        </div>
      </section>
    </>
  );
}
