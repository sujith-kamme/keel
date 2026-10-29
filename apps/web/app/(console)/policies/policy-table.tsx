"use client";

import { type ColDef, type ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { useState } from "react";
import { ListGrid } from "@/components/list-grid";

export interface PolicyListRow {
  id: string;
  name: string;
  type: { label: string; tone: string };
  enforces: string;
  version: number | null;
  draft: number | null;
  lastChange: string;
}

const href = (r: PolicyListRow) => `/policies/${encodeURIComponent(r.id)}`;

const columns: ColDef<PolicyListRow>[] = [
  {
    headerName: "Policy",
    field: "name",
    width: 200,
    cellRenderer: ({ data, value }: ICellRendererParams<PolicyListRow, string>) =>
      data ? (
        <Link href={href(data)} style={{ color: "var(--text)", fontWeight: 500 }}>
          {value}
        </Link>
      ) : null,
  },
  {
    headerName: "Type",
    colId: "type",
    valueGetter: (p) => p.data?.type.label,
    width: 130,
    cellRenderer: ({ data }: ICellRendererParams<PolicyListRow>) => (data ? <span className={`bdg ${data.type.tone}`}>{data.type.label}</span> : null),
  },
  { headerName: "Enforces", field: "enforces", flex: 1, minWidth: 260, cellClass: "mut", tooltipField: "enforces" },
  { headerName: "Version", field: "version", width: 100, cellClass: "mono", valueFormatter: (p) => (p.value === null ? "—" : `v${p.value}`) },
  {
    headerName: "Status",
    colId: "status",
    width: 190,
    valueGetter: (p) => (p.data?.version === null ? "Not approved" : "Active"),
    cellRenderer: ({ data }: ICellRendererParams<PolicyListRow>) =>
      data ? (
        <>
          {data.version === null ? <span className="st">Not approved</span> : <span className="st ok">Active</span>}
          {data.draft !== null && (
            <span className="bdg warn" style={{ marginLeft: 6 }}>
              Draft v{data.draft}
            </span>
          )}
        </>
      ) : null,
  },
  { headerName: "Last change", field: "lastChange", width: 150, cellClass: "mut" },
];

/** The policy list with type tabs computed from the rows. */
export function PolicyTable({ rows }: { rows: PolicyListRow[] }) {
  const types = [...new Set(rows.map((r) => r.type.label))];
  const [type, setType] = useState<string | null>(null);
  const shown = type === null ? rows : rows.filter((r) => r.type.label === type);
  return (
    <>
      <div className="tabsu" role="tablist" aria-label="Policy type">
        {[null, ...types].map((t) => (
          <button key={t ?? "all"} type="button" role="tab" aria-selected={type === t} className={type === t ? "on" : undefined} onClick={() => setType(t)}>
            {t ?? "All"}
            <span className="n">{t === null ? rows.length : rows.filter((r) => r.type.label === t).length}</span>
          </button>
        ))}
      </div>
      <section className="pnl" style={{ minWidth: 0 }}>
        <ListGrid rows={shown} columns={columns} rowId={(r) => r.id} href={href} />
        <div className="tfoot">
          <span>
            {shown.length} {shown.length === 1 ? "policy" : "policies"}
          </span>
          <span>Changing an active version makes certification stale</span>
        </div>
      </section>
    </>
  );
}
