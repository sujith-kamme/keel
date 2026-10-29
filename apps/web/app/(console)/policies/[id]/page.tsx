import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OperatorError, policyVersions, requireConsole } from "@/lib/operator";
import { isPolicyId, policyName, policyType, type PolicyVersion, ruleOnFailure, ruleParams, ruleSummary, shortDate } from "@/lib/policies-view";
import { DraftForm } from "./draft-form";
import { DraftPanel } from "./draft-panel";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function versionStatus(v: PolicyVersion, active: PolicyVersion | null) {
  if (v === active) return "active";
  if (v.status === "APPROVED") return "superseded";
  return v.status.toLowerCase();
}

async function Detail({ params, searchParams }: Pick<PageProps<"/policies/[id]">, "params" | "searchParams">) {
  await connection();
  await requireConsole();
  const { id } = await params;
  if (!isPolicyId(id)) notFound();
  const versions = await policyVersions(id).catch((e: unknown) => {
    if (e instanceof OperatorError && e.status === 404) notFound();
    throw e;
  });
  // Newest first: the first APPROVED is what the engine enforces; a DRAFT above it is pending.
  const active = versions.find((v) => v.status === "APPROVED") ?? null;
  const draft = versions[0]?.status === "DRAFT" ? versions[0] : null;
  const sp = await searchParams;
  const justApproved = active !== null && one(sp.approved) === String(active.version);
  const discarded = one(sp.discarded);
  const justDiscarded = versions.some((v) => v.status === "DISCARDED" && String(v.version) === discarded);
  const drafting = one(sp.draft) === "new" && active !== null;
  const type = policyType((active ?? versions[0])!.type);
  const page = `/policies/${encodeURIComponent(id)}`;

  return (
    <>
      <div className="dh">
        <div>
          <h1>{policyName(id)}</h1>
          <div className="meta">
            <span className="mono">{id}</span>
            <span className={`bdg ${type.tone}`}>{type.label}</span>
            {active ? <span className="st ok">Active v{active.version}</span> : <span className="st">No approved version</span>}
          </div>
        </div>
        {active && (
          <div className="acts">
            <Link className="b" href={drafting ? page : `${page}?draft=new`} scroll={false}>
              <i className="ic ic-plus s14" aria-hidden="true" />
              Draft new version
            </Link>
          </div>
        )}
      </div>

      {justApproved && (
        <div className="pnl" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderColor: "var(--ok-line)", background: "var(--ok-bg)", flexWrap: "wrap" }}>
          <span className="st ok" style={{ color: "var(--ok)", fontWeight: 500 }}>
            v{active.version} approved and enforced
          </span>
          <span className="mut">Certification is now stale.</span>
          <Link className="b xs pri" href="/context" style={{ marginLeft: "auto" }}>
            Run Gauntlet
          </Link>
        </div>
      )}
      {justDiscarded && (
        <div className="pnl" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
          <span className="st" style={{ fontWeight: 500 }}>
            Draft v{discarded} discarded
          </span>
          <span className="mut">The active version and certification are unchanged.</span>
        </div>
      )}

      {drafting && (
        <section className="pnl" aria-labelledby="dn-h">
          <div className="pnl-h">
            <h2 id="dn-h">Draft a new version</h2>
            <Link href={page} scroll={false} className="sm">
              Cancel
            </Link>
          </div>
          <DraftForm policyId={id} />
        </section>
      )}

      {draft && <DraftPanel key={draft.version} policyId={id} active={active} draft={draft} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="stk">
          <section className="pnl" aria-labelledby="tx-h">
            <div className="pnl-h">
              <h2 id="tx-h">Customer-facing text</h2>
            </div>
            <div className="pnl-b">
              {active ? (
                <>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: "24px", whiteSpace: "pre-wrap" }}>{active.approved_text}</p>
                  <p className="sm dim" style={{ margin: "8px 0 0" }}>
                    What the agent may tell customers about this policy. Keel checks the agent&apos;s replies against it.
                  </p>
                </>
              ) : (
                <p className="mut" style={{ margin: 0 }}>
                  Nothing is enforced until a version is approved.
                </p>
              )}
            </div>
          </section>
          {active && (
            <section className="pnl" aria-labelledby="ru-h">
              <div className="pnl-h">
                <h2 id="ru-h">Rules</h2>
              </div>
              {active.rules.length === 0 ? (
                <p className="pnl-b mut" style={{ margin: 0 }}>
                  No rules. Only the reply text is checked.
                </p>
              ) : (
                <div className="tw">
                  <table className="t">
                    <thead>
                      <tr>
                        <th scope="col">Rule</th>
                        <th scope="col">Parameters</th>
                        <th scope="col">On failure</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.rules.map((r, i) => {
                        const fail = ruleOnFailure(r);
                        return (
                          <tr key={i}>
                            <td style={{ whiteSpace: "normal" }}>{ruleSummary(r)}</td>
                            <td className="mono">{ruleParams(r)}</td>
                            <td>
                              <span className={`st ${fail === "Block" ? "bad" : "warn"}`}>{fail}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
        <aside className="stk">
          <section className="pnl" aria-labelledby="dt-h">
            <div className="pnl-h">
              <h2 id="dt-h">Details</h2>
            </div>
            <dl className="facts" style={{ margin: 0 }}>
              <div>
                <dt>Policy ID</dt>
                <dd className="mono">{id}</dd>
              </div>
              <div>
                <dt>Active version</dt>
                <dd className="mono">{active ? `v${active.version}` : "—"}</dd>
              </div>
              {active && (
                <div>
                  <dt>Approved by</dt>
                  <dd>
                    {active.approved_by ?? "Seeded"}
                    {active.approved_at && <span className="dim"> · {shortDate(active.approved_at)}</span>}
                  </dd>
                </div>
              )}
            </dl>
          </section>
          <section className="pnl" aria-labelledby="vh-h">
            <div className="pnl-h">
              <h2 id="vh-h">Versions</h2>
            </div>
            <dl className="facts" style={{ margin: 0 }}>
              {versions.map((v) => (
                <div key={v.version}>
                  <dt>
                    <span className="mono">v{v.version}</span> · {versionStatus(v, active)}
                  </dt>
                  <dd className="mut">{shortDate(v.created_at)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function Page({ params, searchParams }: PageProps<"/policies/[id]">) {
  return (
    <>
      <Link className="back" href="/policies" style={{ alignSelf: "flex-start" }}>
        <i className="ic ic-back s14" aria-hidden="true" />
        All policies
      </Link>
      <Suspense fallback={<p className="mut">Loading…</p>}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
