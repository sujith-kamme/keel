"use client";

import { type ColDef, type ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { KillSwitch } from "@/components/kill-switch";
import { ListGrid } from "@/components/list-grid";

export interface AgentRow {
  id: string;
  name: string;
  model: string;
  prompt: string;
  cert: { label: string; tone: string };
  frozen: boolean;
  lastChange: string;
}

const columns: ColDef<AgentRow>[] = [
  { headerName: "Agent", field: "name", width: 190, cellStyle: { fontWeight: 500 } },
  { headerName: "Model", field: "model", width: 180, cellClass: "mono" },
  { headerName: "System prompt", field: "prompt", width: 150 },
  {
    headerName: "Certification",
    colId: "cert",
    valueGetter: (p) => p.data?.cert.label,
    width: 140,
    cellRenderer: ({ data }: ICellRendererParams<AgentRow>) =>
      data ? (
        <Link href="/context" className={`st ${data.cert.tone}`} style={{ color: "var(--text)" }}>
          {data.cert.label}
        </Link>
      ) : null,
  },
  {
    headerName: "State",
    field: "frozen",
    width: 110,
    cellRenderer: ({ value }: ICellRendererParams<AgentRow, boolean>) => <span className={`st ${value ? "bad" : "ok"}`}>{value ? "Frozen" : "Active"}</span>,
  },
  { headerName: "Last change", field: "lastChange", flex: 1, minWidth: 220, cellClass: "mut" },
  {
    headerName: "",
    colId: "actions",
    width: 140,
    sortable: false,
    resizable: false,
    cellRenderer: ({ data }: ICellRendererParams<AgentRow>) => (data ? <KillSwitch agentId={data.id} frozen={data.frozen} label="agent" /> : null),
  },
];

export function AgentGrid({ rows }: { rows: AgentRow[] }) {
  return (
    <section className="pnl" style={{ minWidth: 0 }}>
      <ListGrid rows={rows} columns={columns} rowId={(r) => r.id} />
    </section>
  );
}
