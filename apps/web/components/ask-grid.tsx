"use client";

import type { GridApi, GridState, StructuredSchemaParams } from "ag-grid-community";
import { useRef, useState, useTransition } from "react";
import { askGrid } from "./ask-grid-action";

const btn = "rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

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
          className="w-80 rounded border border-black/20 bg-transparent px-2 py-1 text-sm dark:border-white/20"
        />
        <button className={btn} disabled={pending || !api || !query.trim()}>
          {pending ? "Asking…" : "Ask"}
        </button>
      </form>
      {examples.map((ex) => (
        <button
          key={ex}
          className="rounded-full border border-black/20 px-3 py-0.5 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
          disabled={pending || !api}
          onClick={() => {
            setQuery(ex);
            ask(ex);
          }}
        >
          {ex}
        </button>
      ))}
      <button className={btn} disabled={pending || !api} onClick={reset}>
        Reset view
      </button>
      {message && <span className="text-sm text-red-700 dark:text-red-300">{message}</span>}
    </div>
  );
}
