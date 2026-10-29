import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AddToGauntlet } from "@/components/add-to-gauntlet";
import { sessionDetail } from "@/lib/keel";
import { requireConsole, reviewQueue } from "@/lib/operator";
import { isPolicyId } from "@/lib/policies-view";
import { reasonLabel } from "@/lib/reason-labels";
import { amountText, buildRows, fromPolicy, isDecisionId } from "@/lib/review-view";
import { relativeTime, sessionState } from "@/lib/sessions-view";
import { ItemActions } from "./item-actions";

async function Item({ params }: { params: Promise<{ decisionId: string }> }) {
  await connection();
  await requireConsole();
  const { decisionId } = await params;
  if (!isDecisionId(decisionId)) notFound();
  // There is no single-item read: the queue holds every pending held action (up to its cap).
  const item = (await reviewQueue()).find((i) => i.kind === "held_action" && i.decision_id === decisionId);
  if (!item) notFound();
  const row = buildRows([item])[0]!;
  // The excerpt is a nice-to-have; the decision stands without it.
  const detail = await sessionDetail(item.session_id).catch(() => null);
  const email = detail?.session.claimed_email;
  const seq = detail?.decisions.find((d) => d.decision_id === decisionId)?.seq;
  const policyId = typeof item.args?.policy_id === "string" && isPolicyId(item.args.policy_id) ? item.args.policy_id : null;
  const amount = row.amount === "" ? null : amountText(row.amount);
  const isRefund = item.tool === "offer_refund";
  const title = isRefund ? ["Refund", amount, email && `to ${email}`] : [amount ? `${amount} discount` : row.action, email && `for ${email}`];
  const summary = [row.action.toLowerCase(), amount].filter(Boolean).join(" ");

  // The turn that carried this decision, and the customer turn before it.
  const turns = detail?.turns ?? [];
  const at = turns.findIndex((t) => t.decision_ids.includes(decisionId));
  const asked = at > 0 ? turns.slice(0, at).findLast((t) => t.role === "customer") : undefined;
  const excerpt = at >= 0 ? [asked, turns[at]].filter((t) => t !== undefined) : [];
  const sessionHref = `/sessions/${encodeURIComponent(item.session_id)}`;
  const st = sessionState(item.session_state);

  return (
    <>
      <div className="dh">
        <div>
          <h1>{title.filter(Boolean).join(" ")}</h1>
          <div className="meta">
            {item.reason_codes.map((c) => (
              <span key={c} className="bdg warn">
                {reasonLabel(c)}
              </span>
            ))}
            {seq === undefined ? (
              <span className="mono">{decisionId}</span>
            ) : (
              <Link href={`/ledger/${seq}`} className="mono">
                {decisionId}
              </Link>
            )}
            <span>Held {relativeTime(item.created_at, new Date())}</span>
          </div>
        </div>
        <div className="acts">
          <ItemActions decisionId={decisionId} summary={`this ${summary}`} approveLabel={isRefund && amount ? `Approve and refund ${amount}` : "Approve"} />
        </div>
      </div>

      <div className="cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="pnl" aria-labelledby="why-h">
            <div className="pnl-h">
              <h2 id="why-h">Why it was held</h2>
            </div>
            <dl className="facts" style={{ margin: 0 }}>
              {item.reason_codes.map((c) => (
                <div key={c}>
                  <dt style={{ color: "var(--text)" }}>
                    {reasonLabel(c)} <span className="mono dim">{c}</span>
                  </dt>
                  <dd>
                    {fromPolicy(c) && policyId ? (
                      <Link href={`/policies/${encodeURIComponent(policyId)}`} className="mono">
                        {policyId}
                      </Link>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="pnl" aria-labelledby="ex-h">
            <div className="pnl-h">
              <h2 id="ex-h">From the conversation</h2>
              <Link href={sessionHref} className="sm">
                Full conversation
              </Link>
            </div>
            <div className="pnl-b" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {excerpt.length === 0 ? (
                <p className="mut" style={{ margin: 0 }}>
                  {detail ? "This decision isn't linked to a turn." : "The conversation could not be loaded."}
                </p>
              ) : (
                excerpt.map((t, i) => (
                  <div key={i}>
                    <div className="sm dim">{t.role === "customer" ? "Customer" : "Agent"}</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
        <aside className="pnl" aria-labelledby="fx-h">
          <div className="pnl-h">
            <h2 id="fx-h">Details</h2>
            <AddToGauntlet sessionId={item.session_id} />
          </div>
          <dl className="facts" style={{ margin: 0 }}>
            <div>
              <dt>Conversation</dt>
              <dd>
                <Link href={sessionHref} className="mono">
                  {item.session_id}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Conversation state</dt>
              <dd>
                <span className={`st ${st.tone}`}>{st.label}</span>
              </dd>
            </div>
            <div>
              <dt>Risk score</dt>
              <dd>{item.score ?? "—"}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd className="mono">{row.order || "—"}</dd>
            </div>
            {detail && (
              <div>
                <dt>Agent</dt>
                <dd>
                  <Link href="/agents" className="mono">
                    {detail.session.agent_id}
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt>If approved</dt>
              <dd>{isRefund ? `PayPal refund${amount ? ` of ${amount}` : ""}` : `Discount code${amount ? ` for ${amount}` : ""} issued`}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}

export default function Page({ params }: PageProps<"/review/[decisionId]">) {
  return (
    <>
      <Link className="back" href="/review">
        <i className="ic ic-back s14" aria-hidden="true" />
        Review queue
      </Link>
      <Suspense fallback={<p className="mut">Loading…</p>}>
        <Item params={params} />
      </Suspense>
    </>
  );
}
