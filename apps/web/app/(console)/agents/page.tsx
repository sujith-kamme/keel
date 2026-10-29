import { AGENT_MODELS, PROMPT_MODES } from "@keel/agent";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { KillSwitch } from "@/components/kill-switch";
import { certBadge } from "@/lib/context-view";
import { agentControl, type AgentControl, gauntletCertification, overview, policies, requireConsole, settings } from "@/lib/operator";
import { usd, utcTime } from "@/lib/overview-view";
import { PROMPTS } from "@/lib/prompt-labels";
import { agentLimits } from "@/lib/settings-view";
import { ScopeDrawer } from "./scope-drawer";

const AGENT = "agt_demo_store";

const lastChange = (c: AgentControl) => (c.updated_at ? `${utcTime(c.updated_at)} UTC by ${c.updated_by ?? "unknown"}` : "No changes yet");

async function Agents() {
  await connection();
  await requireConsole();
  const [agent, all, s, cert, ps, o] = await Promise.all([
    agentControl(AGENT),
    agentControl("*"),
    settings(),
    gauntletCertification(),
    policies(),
    // The 7-day panel is a nicety; the kill switches must still show without it.
    overview().catch(() => null),
  ]);
  const cb = certBadge(cert.status);
  const prompt = String(s.values.agent_prompt);
  const active = ps.filter((p) => p.active !== null);
  const limits = agentLimits(active.flatMap((p) => p.active!.rules));
  return (
    <>
      <div className="pnl tw">
        <table className="t" style={{ minWidth: 880 }}>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Model</th>
              <th scope="col">System prompt</th>
              <th scope="col">Certification</th>
              <th scope="col">State</th>
              <th scope="col">Last change</th>
              <th scope="col">
                <span className="srr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ height: "auto", padding: "8px 12px" }}>
                <div style={{ fontWeight: 500 }}>Store support agent</div>
                <div className="mono dim">{AGENT}</div>
              </td>
              <td className="mono">{String(s.values.agent_model)}</td>
              <td>{PROMPTS[prompt]?.label ?? prompt}</td>
              <td>
                <Link href="/context" className={`st ${cb.tone}`} style={{ color: "var(--text)" }}>
                  {cb.label}
                </Link>
              </td>
              <td>
                <span className={`st ${agent.frozen ? "bad" : "ok"}`}>{agent.frozen ? "Frozen" : "Active"}</span>
              </td>
              <td className="mut">{lastChange(agent)}</td>
              <td className="r">
                <KillSwitch agentId={AGENT} frozen={agent.frozen} label="agent" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" style={{ alignItems: "stretch" }}>
        <section className="pnl" aria-labelledby="sc-p-h">
          <div className="pnl-h">
            <h2 id="sc-p-h">Scope · Store support agent</h2>
            <Link id="edit-scope" href={`/agents?scope=${AGENT}`} scroll={false} className="sm">
              Edit scope
            </Link>
          </div>
          <dl className="facts" style={{ margin: 0 }}>
            <div>
              <dt>Refunds</dt>
              <dd>{limits.refunds ?? "No refund limits in the approved policies"}</dd>
            </div>
            <div>
              <dt>Discounts</dt>
              <dd>{limits.discounts ?? "No discount limit in the approved policies"}</dd>
            </div>
            <div>
              <dt>Policies</dt>
              <dd>
                <Link href="/policies">{active.length} active</Link>
              </dd>
            </div>
          </dl>
        </section>
        <section className="pnl" aria-labelledby="l7-h" style={{ display: "flex", flexDirection: "column" }}>
          <div className="pnl-h">
            <h2 id="l7-h">Last 7 days</h2>
            <Link href="/ledger" className="sm">
              Open ledger
            </Link>
          </div>
          {o ? (
            <div className="kpis" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))", border: 0, borderRadius: 0, flex: 1 }}>
              <div className="kpi">
                <span className="lbl">Violations caught</span>
                <span className="v">{o.violations.last_7_days.total.toLocaleString("en-US")}</span>
                <span className="sm dim">Blocked, held or rewritten on live traffic</span>
              </div>
              <div className="kpi">
                <span className="lbl">Dollars protected</span>
                <span className="v">{usd(o.dollars_protected.last_7_days.total)}</span>
              </div>
            </div>
          ) : (
            <p className="pnl-b mut" style={{ margin: 0 }}>
              Couldn&apos;t load the last 7 days. Try again in a moment.
            </p>
          )}
        </section>
      </div>
      <section style={{ border: "1px solid var(--bad-line)", borderRadius: 8 }} aria-labelledby="dz-h">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--bad-line)" }}>
          <h2 id="dz-h" className="sh" style={{ color: "var(--bad)" }}>
            Danger zone
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 16px", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 500 }}>
              {all.frozen ? "All agents are frozen" : "Freeze all agents"}
              {all.frozen && (
                <span className="st bad" style={{ marginLeft: 8 }}>
                  Frozen
                </span>
              )}
            </div>
            <div className="mut sm">Holds every money action for every agent immediately. Written to the ledger; lift it here.</div>
            <div className="dim sm">{all.updated_at ? `Last change ${lastChange(all)}` : "No changes yet"}</div>
          </div>
          <KillSwitch agentId="*" frozen={all.frozen} label="all agents" danger />
        </div>
      </section>
    </>
  );
}

/** The scope drawer, route-driven: /agents?scope=agt_demo_store. The model and prompt are global settings. */
async function Scope({ searchParams }: { searchParams: PageProps<"/agents">["searchParams"] }) {
  await connection();
  const { scope } = await searchParams;
  if (scope !== AGENT) return null;
  await requireConsole();
  const [s, ps] = await Promise.all([settings(), policies()]);
  return (
    <ScopeDrawer
      key={`${s.values.agent_model}:${s.values.agent_prompt}`}
      agentId={scope}
      model={String(s.values.agent_model)}
      prompt={String(s.values.agent_prompt)}
      models={AGENT_MODELS}
      prompts={PROMPT_MODES}
      limits={agentLimits(ps.flatMap((p) => p.active?.rules ?? []))}
    />
  );
}

function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="pnl" style={{ height: 86 }} />
      <div className="pnl" style={{ height: 160 }} />
      <div className="pnl" style={{ height: 90 }} />
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/agents">) {
  return (
    <>
      <div className="ph">
        <div>
          <h1>Agents</h1>
          <p>AI agents that act through Keel. A frozen agent can still reply, but every money action it attempts is held.</p>
        </div>
      </div>
      <Suspense fallback={<Skeleton />}>
        <Agents />
      </Suspense>
      <Suspense>
        <Scope searchParams={searchParams} />
      </Suspense>
    </>
  );
}
