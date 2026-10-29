"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

/** One page of sessions: state tabs (server-filtered), a search over the loaded page, and cursor paging. */
export function SessionTable({ rows, state, previous, next }: { rows: SessionListRow[]; state: string | null; previous: string | null; next: string | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const shown = rows.filter((r) => matchesSearch({ claimed_email: r.email, id: r.id, order_ids: r.orderIds }, query));
  const href = (id: string) => `/sessions/${encodeURIComponent(id)}`;
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
          placeholder="Filter this page by email, order or session ID"
          aria-label="Filter sessions on this page"
          style={{ width: 320, maxWidth: "100%", marginLeft: "auto", marginBottom: 6 }}
        />
      </div>
      <div className="pnl tw">
        <table className="t" style={{ minWidth: 960 }}>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Agent</th>
              <th scope="col">Order</th>
              <th scope="col">State</th>
              <th scope="col" className="r">
                Risk
              </th>
              <th scope="col" className="r">
                Decisions
              </th>
              <th scope="col" className="r">
                Last turn
              </th>
              <th scope="col">
                <span className="srr">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const st = sessionState(r.state);
              return (
                <tr key={r.id} className="go" onClick={() => router.push(href(r.id))}>
                  <td style={{ height: "auto", padding: "8px 12px" }}>
                    <Link href={href(r.id)} style={{ color: "var(--text)", fontWeight: 500 }}>
                      {r.email}
                    </Link>
                    {!r.verified && <span className="sm dim"> · not verified</span>}
                    <div className="mono dim">{r.id}</div>
                  </td>
                  <td className="mono mut">{r.agentId}</td>
                  <td className={r.orderIds.length > 0 ? "mono mut" : "dim"} title={r.orderIds.join(", ")}>
                    {r.orderIds[0] ?? "—"}
                    {r.orderIds.length > 1 && <span className="sm dim"> +{r.orderIds.length - 1}</span>}
                  </td>
                  <td>
                    <span className={`st ${st.tone}`}>{st.label}</span>
                  </td>
                  <td className="r mono">{r.risk ?? "—"}</td>
                  <td className="r">{r.decisions}</td>
                  <td className="r mut">{r.lastTurn ?? "—"}</td>
                  <td className="chev">
                    <i className="ic ic-chev" aria-hidden="true" />
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="mut">
                  {rows.length === 0 ? "No sessions here." : "No session on this page matches."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="tfoot">
          <span>
            {query.trim() ? `${shown.length} of ${rows.length}` : rows.length} {rows.length === 1 ? "session" : "sessions"} on this page
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
      </div>
    </>
  );
}
