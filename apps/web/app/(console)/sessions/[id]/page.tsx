import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { AddToGauntlet } from "@/components/add-to-gauntlet";
import { ReleaseButton } from "@/components/release-button";
import { KeelError, sessionDetail, type DecisionSummary, type SessionDetail } from "@/lib/keel";
import { canLearn } from "@/lib/context-view";
import { decision, utcTime } from "@/lib/overview-view";
import { reasonLabel } from "@/lib/reason-labels";
import { canRelease } from "@/lib/review-view";
import { attachDecisions, relativeTime, riskLevel, riskWidth, sessionState, signalKind } from "@/lib/sessions-view";
import { requireConsole } from "@/lib/operator";

const BOX_TONE: Record<string, { border: string; background: string }> = {
  bad: { border: "var(--bad-line)", background: "var(--bad-bg)" },
  warn: { border: "var(--warn-line)", background: "var(--warn-bg)" },
};

/** The guard's draft and the reply that was sent, the commitments it found, and the extractor's latency. */
function GuardDetail({ d, guard }: { d: DecisionSummary; guard: NonNullable<DecisionSummary["guard"]> }) {
  const unavailable = guard.latency_ms === null || d.reason_codes.includes("EXTRACTOR_UNAVAILABLE");
  const changed = guard.final_reply !== "" && guard.final_reply !== guard.draft;
  return (
    <details open={d.verdict !== "ALLOW"} className="sm" style={{ width: "100%" }}>
      <summary style={{ cursor: "pointer" }} className="mut">
        Why
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
        <div>
          <span className="dim">Draft </span>
          <span style={changed ? { textDecoration: "line-through" } : undefined}>{guard.draft}</span>
        </div>
        {changed && (
          <div>
            <span className="dim">Sent </span>
            {guard.final_reply}
          </div>
        )}
        {guard.commitments.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {guard.commitments.map((c, i) => (
              <li key={i}>
                {c.type}: &ldquo;{c.quoted_text}&rdquo;
              </li>
            ))}
          </ul>
        ) : (
          <div className="mut">No commitments found</div>
        )}
        <div className="dim">{unavailable ? "Extractor unavailable" : `Extractor: ${guard.latency_ms} ms`}</div>
      </div>
    </details>
  );
}

function DecisionRow({ d }: { d: DecisionSummary }) {
  const v = decision(d.verdict);
  const tone = BOX_TONE[v.tone] ?? { border: "var(--line)", background: "var(--canvas)" };
  const reasons = d.reason_codes.map(reasonLabel).join(", ");
  return (
    <div className="sm" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "6px 10px", border: `1px solid ${tone.border}`, borderRadius: 6, background: tone.background }}>
      <span className={`st ${v.tone}`}>{v.label}</span>
      <span className="mono">{d.tool}</span>
      <span className="mut">{[reasons, d.order_id].filter(Boolean).join(" · ")}</span>
      <Link href={`/ledger/${d.seq}`} style={{ marginLeft: "auto" }}>
        Ledger
      </Link>
      {d.guard && <GuardDetail d={d} guard={d.guard} />}
    </div>
  );
}

function RiskPanel({ risk }: { risk: SessionDetail["risk"] }) {
  const now = new Date();
  return (
    <section className="pnl" aria-labelledby="rk-h">
      <div className="pnl-h">
        <h2 id="rk-h">Risk</h2>
        {risk && (
          <span className="sm mut">
            {risk.score} of {risk.threshold} to quarantine
          </span>
        )}
      </div>
      {risk ? (
        <>
          <div className="pnl-b" style={{ paddingBottom: risk.signals.length > 0 ? 8 : 16 }}>
            <div className="meter">
              <span style={{ width: `${riskWidth(risk.score, risk.threshold)}%`, background: `var(--${{ low: "ok", medium: "warn", high: "bad" }[riskLevel(risk.score, risk.threshold)]}-dot)` }} />
            </div>
            {risk.signals.length === 0 && <p className="sm mut" style={{ margin: "10px 0 0" }}>No risk signals.</p>}
          </div>
          {risk.signals.length > 0 && (
            <dl className="facts" style={{ margin: 0 }}>
              {risk.signals.map((s, i) => (
                <div key={i}>
                  <dt>{signalKind(s.kind)}</dt>
                  <dd>
                    +{s.weight} · {relativeTime(s.at, now)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : (
        <p className="pnl-b sm mut" style={{ margin: 0 }}>
          Risk unavailable.
        </p>
      )}
    </section>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireConsole();
  const { id } = await params;
  const detail = await sessionDetail(id).catch((e) => {
    if (e instanceof KeelError && e.status === 404) notFound();
    throw e;
  });
  const { session, risk } = detail;
  const { turns, unlinked } = attachDecisions(detail.turns, detail.decisions);
  const st = sessionState(session.state);
  const live = session.mode === "LIVE";
  const count = (verdict: string) => detail.decisions.filter((d) => d.verdict === verdict).length;
  const refused = [`${count("BLOCK")} blocked`, `${count("HOLD")} held`, `${count("REWRITE")} rewritten`].filter((s) => !s.startsWith("0 "));

  return (
    <>
      <div className="dh">
        <div>
          <h1>{session.claimed_email}</h1>
          <div className="meta">
            <span className="mono">{session.id}</span>
            <span>
              with{" "}
              <Link href="/agents" className="mono">
                {session.agent_id}
              </Link>
            </span>
            <span className={`st ${st.tone}`}>{st.label}</span>
            {!live && <span className="bdg">Context run</span>}
            <span>Started {utcTime(session.created_at)} UTC</span>
          </div>
        </div>
        <div className="acts">
          <Link className="b" href="/ledger">
            Open in ledger
          </Link>
          {live && canLearn(session.state, detail.decisions.map((d) => d.verdict)) && <AddToGauntlet sessionId={session.id} className="b" />}
          {live && canRelease(session.state) && <ReleaseButton sessionId={session.id} className="b pri" />}
        </div>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi">
          <span className="lbl">Risk</span>
          <span className="v">{risk ? risk.score : "—"}</span>
          <span className="sm dim">{risk ? `${riskLevel(risk.score, risk.threshold)} · quarantine at ${risk.threshold}` : "unavailable"}</span>
        </div>
        <div className="kpi">
          <span className="lbl">Decisions</span>
          <span className="v">{detail.decisions.length}</span>
          <span className="sm dim">{refused.length > 0 ? refused.join(" · ") : "none refused"}</span>
        </div>
        <div className="kpi">
          <span className="lbl">Buyer</span>
          <span className="v" style={{ fontSize: 18 }}>
            {session.verified ? "Verified" : "Not verified"}
          </span>
          <span className="sm dim">{session.verified ? "payer confirmed by one-time code" : "one-time code not confirmed"}</span>
        </div>
      </div>

      <div className="cols">
        <section className="pnl" aria-labelledby="cv-h" style={{ minWidth: 0 }}>
          <div className="pnl-h">
            <h2 id="cv-h">Conversation</h2>
            <span className="sm dim">Keel decisions shown under the turn they belong to</span>
          </div>
          <div className="pnl-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {turns.length === 0 && <p className="mut" style={{ margin: 0 }}>No turns yet.</p>}
            {turns.map((t, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <div className="sm dim">
                    {t.role === "customer" ? (
                      "Customer"
                    ) : (
                      <>
                        Agent · <span className="mono">{session.agent_id}</span>
                      </>
                    )}{" "}
                    · {utcTime(t.created_at)}
                  </div>
                  <div style={{ marginTop: 2, whiteSpace: "pre-wrap" }}>{t.text}</div>
                </div>
                {t.decisions.map((d) => (
                  <DecisionRow key={d.decision_id} d={d} />
                ))}
              </div>
            ))}
            {unlinked.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
                <h3 className="sh" style={{ fontSize: 13 }}>
                  Other decisions
                </h3>
                {unlinked.map((d) => (
                  <DecisionRow key={d.decision_id} d={d} />
                ))}
              </div>
            )}
          </div>
        </section>
        <aside style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <RiskPanel risk={risk} />
          <section className="pnl" aria-labelledby="by-h">
            <div className="pnl-h">
              <h2 id="by-h">Buyer</h2>
            </div>
            <dl className="facts" style={{ margin: 0 }}>
              <div>
                <dt>Claimed email</dt>
                <dd>{session.claimed_email}</dd>
              </div>
              <div>
                <dt>Verified</dt>
                <dd>{session.verified ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>{session.order_ids.length === 1 ? "Order" : "Orders"}</dt>
                <dd className="mono">{session.order_ids.length > 0 ? session.order_ids.join(", ") : "—"}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function Page({ params }: PageProps<"/sessions/[id]">) {
  return (
    <>
      <Link className="back" href="/sessions">
        <i className="ic ic-back s14" aria-hidden="true" />
        All sessions
      </Link>
      <Suspense fallback={<p className="mut">Loading…</p>}>
        <Detail params={params} />
      </Suspense>
      <AutoRefresh ms={3000} />
    </>
  );
}
