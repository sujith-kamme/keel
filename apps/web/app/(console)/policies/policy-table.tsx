"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PolicyListRow {
  id: string;
  name: string;
  type: { label: string; tone: string };
  enforces: string;
  version: number | null;
  draft: number | null;
  lastChange: string;
}

/** The policy list with type tabs computed from the rows. */
export function PolicyTable({ rows }: { rows: PolicyListRow[] }) {
  const router = useRouter();
  const types = [...new Set(rows.map((r) => r.type.label))];
  const [type, setType] = useState<string | null>(null);
  const shown = type === null ? rows : rows.filter((r) => r.type.label === type);
  const href = (id: string) => `/policies/${encodeURIComponent(id)}`;
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
      <div className="pnl tw">
        <table className="t" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th scope="col">Policy</th>
              <th scope="col">Type</th>
              <th scope="col">Enforces</th>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Last change</th>
              <th scope="col">
                <span className="srr">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="go" onClick={() => router.push(href(r.id))}>
                <td style={{ height: "auto", padding: "8px 12px" }}>
                  <Link href={href(r.id)} style={{ color: "var(--text)", fontWeight: 500 }}>
                    {r.name}
                  </Link>
                  <div className="mono dim">{r.id}</div>
                </td>
                <td>
                  <span className={`bdg ${r.type.tone}`}>{r.type.label}</span>
                </td>
                <td className="mut" style={{ whiteSpace: "normal" }}>
                  {r.enforces}
                </td>
                <td className="mono">{r.version === null ? "—" : `v${r.version}`}</td>
                <td>
                  {r.version === null ? <span className="st">Not approved</span> : <span className="st ok">Active</span>}
                  {r.draft !== null && (
                    <span className="bdg warn" style={{ marginLeft: 6 }}>
                      Draft v{r.draft}
                    </span>
                  )}
                </td>
                <td className="mut">{r.lastChange}</td>
                <td className="chev">
                  <i className="ic ic-chev" aria-hidden="true" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tfoot">
          <span>
            {shown.length} {shown.length === 1 ? "policy" : "policies"}
          </span>
          <span>Changing an active version makes certification stale</span>
        </div>
      </div>
    </>
  );
}
