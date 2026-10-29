"use client";

import { type ColDef, type ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { ListGrid } from "@/components/list-grid";
import type { Activity } from "@/lib/overview-view";

const href = (r: Activity) => `/ledger/${r.seq}`;

const columns: ColDef<Activity>[] = [
  // The time is display text; the ledger sequence orders it.
  { headerName: "Time (UTC)", field: "time", width: 150, cellClass: "mut", comparator: (_a, _b, x, y) => (x.data?.seq ?? 0) - (y.data?.seq ?? 0) },
  {
    headerName: "Event",
    field: "event",
    flex: 1,
    minWidth: 240,
    cellRenderer: ({ data, value }: ICellRendererParams<Activity, string>) =>
      data ? (
        <Link href={href(data)} style={{ color: "var(--text)" }}>
          {value}
        </Link>
      ) : null,
  },
  { headerName: "Reference", field: "reference", width: 170, cellClass: "mono", valueFormatter: (p) => p.value ?? "—" },
  { headerName: "Amount", field: "amount", width: 120, type: "rightAligned", valueFormatter: (p) => p.value ?? "—" },
  {
    headerName: "Decision",
    colId: "decision",
    valueGetter: (p) => p.data?.decision.label,
    width: 130,
    cellRenderer: ({ data }: ICellRendererParams<Activity>) => (data ? <span className={`st ${data.decision.tone}`}>{data.decision.label}</span> : null),
  },
];

export function RecentGrid({ rows }: { rows: Activity[] }) {
  return <ListGrid rows={rows} columns={columns} rowId={(r) => String(r.seq)} href={href} />;
}
