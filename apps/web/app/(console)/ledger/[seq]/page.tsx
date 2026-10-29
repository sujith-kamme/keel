import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { entrySentence, entryTitle, hashCheck, isBeforeSeq, utcStamp } from "@/lib/ledger-view";
import { OperatorError, ledgerEntry, requireConsole } from "@/lib/operator";
import { decision } from "@/lib/overview-view";
import { CopyJson } from "./copy-json";

const wrap = { whiteSpace: "normal", wordBreak: "break-all" } as const;

function Neighbour({ label, seq }: { label: string; seq: number | undefined }) {
  if (seq === undefined)
    return (
      <button type="button" className="b xs" disabled>
        {label}
      </button>
    );
  return (
    <Link className="b xs" href={`/ledger/${seq}`}>
      {label}
    </Link>
  );
}

async function Entry({ params }: { params: Promise<{ seq: string }> }) {
  await connection();
  await requireConsole();
  const { seq: raw } = await params;
  const seq = /^\d{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!isBeforeSeq(seq)) notFound();
  const e = await ledgerEntry(seq).catch((err: unknown) => {
    if (err instanceof OperatorError && err.status === 404) notFound();
    throw err;
  });
  const r = e.entry;
  const v = decision(r.verdict);
  const check = hashCheck(e);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link className="back" href="/ledger">
          <i className="ic ic-back s14" aria-hidden="true" />
          Ledger
        </Link>
        <span className="acts" style={{ marginLeft: "auto" }}>
          <Neighbour label="Previous" seq={e.prev?.seq} />
          <Neighbour label="Next" seq={e.next?.seq} />
        </span>
      </div>

      <div className="dh">
        <div>
          <h1>
            Entry {r.seq} · {entryTitle(r)}
          </h1>
          <div className="meta">
            <span className={`st ${v.tone}`}>{v.label}</span>
            {r.tool && <span className="mono">{r.tool}</span>}
            {r.reason_codes.map((c) => (
              <span key={c} className="mono">
                {c}
              </span>
            ))}
            <span>{utcStamp(r.created_at)} UTC</span>
          </div>
        </div>
        <div className="acts">
          <CopyJson value={r} />
        </div>
      </div>

      <div className="pnl" role="status" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
        <i className="ic ic-shield" style={{ color: check.ok ? "var(--ok)" : "var(--bad)" }} aria-hidden="true" />
        <span style={{ fontWeight: 500 }}>{check.title}</span>
        <span className="mut">{check.detail}</span>
      </div>

      <div className="cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="pnl" aria-labelledby="wh-h">
            <div className="pnl-h">
              <h2 id="wh-h">What happened</h2>
            </div>
            <div className="pnl-b">
              <p style={{ margin: 0 }}>{entrySentence(r)}</p>
            </div>
          </section>
          <section className="pnl" aria-labelledby="pl-h">
            <div className="pnl-h">
              <h2 id="pl-h">Payload</h2>
              <span className="sm dim">hashed with the entry&apos;s fields</span>
            </div>
            <pre className="mono" style={{ margin: 0, padding: "14px 16px", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: "19px" }}>
              {JSON.stringify(r.payload, null, 2)}
            </pre>
          </section>
        </div>
        <aside style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="pnl" aria-labelledby="ef-h">
            <div className="pnl-h">
              <h2 id="ef-h">Entry</h2>
            </div>
            <dl className="facts" style={{ margin: 0 }}>
              <div>
                <dt>Sequence</dt>
                <dd className="mono">{r.seq}</dd>
              </div>
              <div>
                <dt>Decision</dt>
                <dd className="mono" style={wrap}>
                  {r.decision_id}
                </dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{r.mode === "LIVE" ? "Live" : r.mode === "CONTEXT" ? "Simulation" : r.mode}</dd>
              </div>
              <div>
                <dt>Conversation</dt>
                <dd>
                  {r.session_id ? (
                    <Link href={`/sessions/${encodeURIComponent(r.session_id)}`} className="mono">
                      {r.session_id}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd className="mono">{r.order_id ?? "—"}</dd>
              </div>
              <div>
                <dt>Dispute</dt>
                <dd>
                  {r.dispute_id ? (
                    <Link href={`/disputes/${encodeURIComponent(r.dispute_id)}`} className="mono">
                      {r.dispute_id}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {r.capture_id && (
                <div>
                  <dt>Capture</dt>
                  <dd className="mono">{r.capture_id}</dd>
                </div>
              )}
            </dl>
          </section>
          <section className="pnl" aria-labelledby="ch-h">
            <div className="pnl-h">
              <h2 id="ch-h">Chain</h2>
            </div>
            <dl className="facts" style={{ margin: 0 }}>
              <div>
                <dt>Hash</dt>
                <dd className="mono sm" style={wrap}>
                  {r.hash}
                </dd>
              </div>
              <div>
                <dt>Previous</dt>
                <dd className="mono sm" style={wrap}>
                  {r.prev_hash === null ? "None: first entry" : e.prev ? <Link href={`/ledger/${e.prev.seq}`}>{r.prev_hash}</Link> : r.prev_hash}
                </dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd className="mono sm" style={wrap}>
                  {e.next ? <Link href={`/ledger/${e.next.seq}`}>{e.next.hash}</Link> : "None yet: newest entry"}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function Page({ params }: PageProps<"/ledger/[seq]">) {
  return (
    <Suspense fallback={<p className="mut">Loading…</p>}>
      <Entry params={params} />
    </Suspense>
  );
}
