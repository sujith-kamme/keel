import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import {
  actionLabel,
  classTag,
  disputeTimeline,
  injectionText,
  isDisputeId,
  money,
  operatorActions,
  outcomeTag,
  paypalStatus,
  reasonLabel,
  type DisputeLedgerView,
} from "@/lib/disputes-view";
import { OperatorError, dispute, requireConsole } from "@/lib/operator";
import { decision, toolLabel, utcTime } from "@/lib/overview-view";
import { reasonLabel as codeLabel } from "@/lib/reason-labels";
import { DecisionButtons, SandboxButtons } from "./buttons";

const entryHref = (seq: number) => `/ledger/${seq}`;
const sessionHref = (id: string) => `/sessions/${encodeURIComponent(id)}`;

function LedgerRows({ rows }: { rows: DisputeLedgerView[] }) {
  if (rows.length === 0) return <p className="pnl-b mut" style={{ margin: 0 }}>No ledger entries matched this payment.</p>;
  return (
    <div className="tw">
      <table className="t" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th scope="col">Time (UTC)</th>
            <th scope="col">Decision</th>
            <th scope="col">What</th>
            <th scope="col">Reason</th>
            <th scope="col">Conversation</th>
            <th scope="col" className="r">
              Entry
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = decision(r.verdict);
            const amount = typeof r.args?.amount === "string" ? ` ${r.args.amount}` : "";
            return (
              <tr key={r.decision_id}>
                <td className="mono mut">{utcTime(r.created_at)}</td>
                <td>
                  <span className={`st ${v.tone}`}>{v.label}</span>
                </td>
                <td>
                  {toolLabel(r.tool)}
                  {amount}
                </td>
                <td className="mut">{r.reason_codes.map(codeLabel).join(", ")}</td>
                <td>
                  {r.session_id ? (
                    <Link href={sessionHref(r.session_id)} className="mono">
                      {r.session_id}
                    </Link>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
                <td className="r">
                  <Link href={entryHref(r.seq)} className="mono">
                    {r.seq}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireConsole();
  const { id } = await params;
  if (!isDisputeId(id)) notFound();
  const d = await dispute(id).catch((e: unknown) => {
    if (e instanceof OperatorError && e.status === 404) notFound();
    throw e;
  });
  const actions = operatorActions(d);
  const c = classTag(d.classification);
  const o = outcomeTag(d.outcome);
  const own = d.decisions.find((r) => r.decision_id === d.decision_id);
  const sessions = [...new Set(d.evidence.map((r) => r.session_id).filter((s) => s !== null))];
  const timeline = disputeTimeline(d);
  const pdfHref = `/disputes/${encodeURIComponent(d.id)}/evidence`;

  return (
    <>
      <div className="dh">
        <div>
          <h1 className="mono" style={{ fontSize: 20 }}>
            {d.id}
          </h1>
          <div className="meta">
            <span>
              {reasonLabel(d.reason)} · {money(d.amount, d.currency)}
            </span>
            <span className={`bdg ${c.tone}`}>{c.label}</span>
            <span className={`st ${o.tone}`}>{o.label}</span>
          </div>
        </div>
        <div className="acts">
          {d.has_evidence && (
            <a className="b" href={pdfHref} target="_blank" rel="noopener">
              <i className="ic ic-file s14" aria-hidden="true" />
              Evidence PDF
            </a>
          )}
          {actions.length > 0 && <DecisionButtons id={d.id} actions={actions} />}
        </div>
      </div>

      {d.action_error && (
        <div className="pnl" role="alert" style={{ padding: "12px 16px", borderColor: "var(--bad-line)", background: "var(--bad-bg)", color: "var(--bad)" }}>
          PayPal said: <span className="mono">{d.action_error}</span>
        </div>
      )}

      <div className="cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="pnl" aria-labelledby="kd-h">
            <div className="pnl-h">
              <h2 id="kd-h">Keel&apos;s decision</h2>
              {d.decision_id &&
                (own ? (
                  <Link href={entryHref(own.seq)} className="sm mono">
                    {d.decision_id}
                  </Link>
                ) : (
                  <span className="sm mono dim">{d.decision_id}</span>
                ))}
            </div>
            <dl className="facts" style={{ margin: 0 }}>
              <div>
                <dt>Classification</dt>
                <dd>
                  <span className={`bdg ${c.tone}`}>{c.label}</span>
                </dd>
              </div>
              <div>
                <dt>Action taken</dt>
                <dd>{actionLabel(d.action, d.classification)}</dd>
              </div>
              {d.reason_codes.map((code) => (
                <div key={code}>
                  <dt>Reason</dt>
                  <dd>
                    {codeLabel(code)} <span className="mono dim">{code}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="pnl" aria-labelledby="tl-h">
            <div className="pnl-h">
              <h2 id="tl-h">Timeline</h2>
              <span className="sm dim">UTC · times Keel recorded</span>
            </div>
            <div className="tw">
              <table className="t">
                <tbody>
                  {timeline.map((e, i) => (
                    <tr key={i}>
                      <td className="mono mut" style={{ width: 120 }}>
                        {utcTime(e.at)}
                      </td>
                      <td>
                        <span className={`st ${e.tone}`}>{e.label}</span>
                      </td>
                      <td className="mut">{e.note}</td>
                      <td className="r">
                        {e.seq !== null && (
                          <Link href={entryHref(e.seq)} className="sm mono">
                            Entry {e.seq}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="pnl" aria-labelledby="bm-h">
            <div className="pnl-h">
              <h2 id="bm-h">Buyer&apos;s message</h2>
              {d.injection === "flagged" && <span className="bdg bad">Prompt injection: treated as data only</span>}
            </div>
            <div className="pnl-b" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {d.buyer_messages.length === 0 ? (
                <p className="mut" style={{ margin: 0 }}>
                  None.
                </p>
              ) : (
                d.buyer_messages.map((m, i) => (
                  <blockquote key={i} style={{ margin: 0, paddingLeft: 12, borderLeft: "2px solid var(--line-strong)", whiteSpace: "pre-wrap" }}>
                    {m}
                  </blockquote>
                ))
              )}
            </div>
          </section>

          <section className="pnl" aria-labelledby="wl-h">
            <div className="pnl-h">
              <h2 id="wl-h">What the ledger shows</h2>
              <span className="sm dim">The entries the classification was based on</span>
            </div>
            <LedgerRows rows={d.evidence} />
          </section>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="pnl" aria-labelledby="df-h">
            <div className="pnl-h">
              <h2 id="df-h">Details</h2>
            </div>
            <dl className="facts" style={{ margin: 0 }}>
              <div>
                <dt>Order</dt>
                <dd className="mono">{d.order_id ?? "Not matched"}</dd>
              </div>
              <div>
                <dt>Capture</dt>
                <dd className="mono">{d.capture_id ?? "—"}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{money(d.amount, d.currency)}</dd>
              </div>
              <div>
                <dt>Conversation</dt>
                <dd style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {sessions.length === 0
                    ? "—"
                    : sessions.map((s) => (
                        <Link key={s} href={sessionHref(s)} className="mono">
                          {s}
                        </Link>
                      ))}
                </dd>
              </div>
              <div>
                <dt>Injection scan</dt>
                <dd>{injectionText(d.injection)}</dd>
              </div>
              <div>
                <dt>PayPal status</dt>
                <dd className="mono" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                  {paypalStatus(d)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="pnl" aria-labelledby="ev-h">
            <div className="pnl-h">
              <h2 id="ev-h">Evidence</h2>
              {d.evidence_type && <span className="sm mono dim">{d.evidence_type}</span>}
            </div>
            {d.has_evidence ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                  <i className="ic ic-file" style={{ color: "var(--text-3)" }} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      keel-evidence-{d.id}.pdf
                    </div>
                    {d.evidence_notes && <div className="sm dim">{d.evidence_notes}</div>}
                  </div>
                  <a className="b xs" href={pdfHref} target="_blank" rel="noopener">
                    Open
                  </a>
                </div>
                {d.evidence_sha256 && (
                  <dl className="facts" style={{ margin: 0 }}>
                    <div>
                      <dt>SHA-256</dt>
                      <dd className="mono sm" style={{ whiteSpace: "normal", wordBreak: "break-all" }}>
                        {d.evidence_sha256}
                      </dd>
                    </div>
                  </dl>
                )}
              </>
            ) : (
              <p className="pnl-b mut" style={{ margin: 0 }}>
                No evidence pack: no order matched this dispute.
              </p>
            )}
          </section>

          {d.sandbox && d.outcome === "OPEN" && (
            <section className="pnl" aria-labelledby="sb-h" style={{ borderStyle: "dashed" }}>
              <div className="pnl-h">
                <h2 id="sb-h">Sandbox</h2>
              </div>
              <div className="pnl-b">
                <p className="sm mut" style={{ margin: 0 }}>
                  Escalating moves the case to a claim; PayPal then offers a ruling after its review (about 30 minutes in the sandbox).
                </p>
                <SandboxButtons id={d.id} canEscalate={d.offered.includes("escalate")} canRule={d.offered.includes("adjudicate")} />
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

export default function Page({ params }: PageProps<"/disputes/[id]">) {
  return (
    <>
      <Link className="back" href="/disputes">
        <i className="ic ic-back s14" aria-hidden="true" />
        All disputes
      </Link>
      <Suspense fallback={<p className="mut">Loading…</p>}>
        <Detail params={params} />
      </Suspense>
      <AutoRefresh ms={3000} />
    </>
  );
}
