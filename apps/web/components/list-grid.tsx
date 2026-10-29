"use client";

import { type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useAgTheme } from "@/lib/ag-theme";

import "@/lib/ag-grid";

/** Lists this short size to their rows; longer ones get the ledger's fixed frame, so only the rows scroll. */
const FIT_ROWS = 12;

export const gridFrame = (rows: number) =>
  rows <= FIT_ROWS ? ({ style: undefined, domLayout: "autoHeight" } as const) : ({ style: { height: 640 }, domLayout: "normal" } as const);

/** A console list in the ledger's grid: shared theme, sortable columns, optional row link. */
export function ListGrid<T>({ rows, columns, rowId, href, empty }: { rows: T[]; columns: ColDef<T>[]; rowId: (row: T) => string; href?: (row: T) => string; empty?: string }) {
  const router = useRouter();
  const { grid } = useAgTheme();
  const theme = useMemo(() => grid.withParams({ wrapperBorder: false, wrapperBorderRadius: 0 }), [grid]);
  const defaultColDef = useMemo<ColDef<T>>(() => ({ sortable: true, resizable: true }), []);
  const frame = gridFrame(rows.length);
  return (
    <div style={frame.style}>
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        getRowId={(p) => rowId(p.data)}
        domLayout={frame.domLayout}
        rowStyle={href ? { cursor: "pointer" } : undefined}
        onRowClicked={href ? (e) => e.data && router.push(href(e.data)) : undefined}
        localeText={empty ? { noRowsToShow: empty } : undefined}
      />
    </div>
  );
}
