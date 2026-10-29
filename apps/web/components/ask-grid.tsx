"use client";

import type { GridApi, GridState, StructuredSchemaParams } from "ag-grid-community";
import { useRef, useState, useTransition } from "react";
import { askGrid } from "./ask-grid-action";

/**
 * "Ask the ledger": Claude turns a request into grid state (filter, sort, grouping). Row data never leaves the browser.
 * `filterColumns` limits which columns the schema offers filters for: on a wide grid the full filter schema is
 * too large for Claude's structured-output grammar.
 */
export function AskGrid({
  api,
  examples,
  schemaParams,
  filterColumns,
}: {
  api: GridApi | null;
  examples: string[];
  schemaParams?: StructuredSchemaParams;
  filterColumns?: string[];
}) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const original = useRef<GridState | null>(null);

  const ask = (q: string) => {
    if (!api || !q.trim()) return;
    setMessage(null);
    start(async () => {
      // Excluding unused features keeps the schema inside Claude's structured-output grammar limit.
      const schema = api.getStructuredSchema({ exclude: ["columnSizing", "pivot", "columnVisibility", "aggregation"], ...schemaParams });
      const model = schema.properties?.filter?.properties?.filterModel;
      if (filterColumns && model) {
        model.properties = Object.fromEntries(Object.entries(model.properties).filter(([id]) => filterColumns.includes(id)));
        model.required = model.required.filter((id: string) => filterColumns.includes(id));
      }
      const r = await askGrid(q, schema);
      if (!r.ok) return setMessage(r.message);
      original.current ??= api.getState();
      api.setState(r.state as GridState);
    });
  };
  const reset = () => {
    if (api && original.current) api.setState(original.current);
    setMessage(null);
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(query);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask for a view, e.g. held refunds over $50"
          maxLength={500}
          aria-label="Ask for a view"
          className="in"
          style={{ width: 300, maxWidth: "100%" }}
        />
        <button className="b" disabled={pending || !api || !query.trim()}>
          {pending ? "Asking…" : "Ask"}
        </button>
      </form>
      {examples.map((ex) => (
        <button
          key={ex}
          className="flt"
          disabled={pending || !api}
          onClick={() => {
            setQuery(ex);
            ask(ex);
          }}
        >
          {ex}
        </button>
      ))}
      <button className="b ghost" disabled={pending || !api} onClick={reset}>
        Reset view
      </button>
      {message && (
        <span className="sm" style={{ color: "var(--bad)" }}>
          {message}
        </span>
      )}
    </div>
  );
}
