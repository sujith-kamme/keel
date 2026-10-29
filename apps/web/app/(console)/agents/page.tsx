import { AGENT_IDS, AGENT_MODELS, AGENTS, isAgentId, PROMPT_MODES } from "@keel/agent";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { KillSwitch } from "@/components/kill-switch";
import { certBadge } from "@/lib/context-view";
import { agentControl, type AgentControl, gauntletCertification, overview, policies, requireConsole, settings } from "@/lib/operator";
import { usd, utcTime } from "@/lib/overview-view";
import { PROMPTS } from "@/lib/prompt-labels";
import { agentLimits } from "@/lib/settings-view";
import { AgentGrid } from "./agent-grid";
import { ScopeDrawer } from "./scope-drawer";

const lastChange = (c: AgentControl) => (c.updated_at ? `${utcTime(c.updated_at)} UTC by ${c.updated_by ?? "unknown"}` : "No changes yet");

async function Agents() {
  await connection();
  await requireConsole();
  const [controls, all, s, certs, ps, o] = await Promise.all([
    Promise.all(AGENT_IDS.map((id) => agentControl(id))),
    agentControl("*"),
    settings(),
    Promise.all(AGENT_IDS.map((id) => gauntletCertification(id))),
    policies(),
    // The 7-day panel is a nicety; the kill switches must still show without it.
    overview().catch(() => null),
  ]);
  const active = ps.filter((p) => p.active !== null);
  const limits = agentLimits(active.flatMap((p) => p.active!.rules));
  return (
    <>
      <AgentGrid
        rows={AGENT_IDS.map((id, i) => {
          const prompt = String(s.values[`${AGENTS[id].role}_agent_prompt`]);
          return {
            id,
            name: AGENTS[id].name,
            model: String(s.values[`${AGENTS[id].role}_agent_model`]),
            prompt: PROMPTS[prompt]?.label ?? prompt,
            cert: certBadge(certs[i]!.status, certs[i]!.active_run),
            frozen: controls[i]!.frozen,
            lastChange: lastChange(controls[i]!),
          };
        })}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" style={{ alignItems: "stretch" }}>
        <section className="pnl" aria-labelledby="sc-p-h">
          <div className="pnl-h">
            <h2 id="sc-p-h">Scope</h2>
          </div>
          <dl className="facts" style={{ margin: 0 }}>
            {AGENT_IDS.map((id) => (
              <div key={id}>
                <dt>{AGENTS[id].name}</dt>
                <dd>
                  <span className="mono sm">{AGENTS[id].allow.join(", ")}</span>{" "}
                  <Link id={`edit-scope-${id}`} href={`/agents?scope=${id}`} scroll={false} className="sm">
                    Edit scope
                  </Link>
                </dd>
              </div>
            ))}
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

/** The scope drawer, route-driven: /agents?scope=<agent id>. Each agent has its own model and prompt settings. */
async function Scope({ searchParams }: { searchParams: PageProps<"/agents">["searchParams"] }) {
  await connection();
  const { scope } = await searchParams;
  if (!isAgentId(scope)) return null;
  await requireConsole();
  const [s, ps] = await Promise.all([settings(), policies()]);
  const { name, role, allow } = AGENTS[scope];
  const model = String(s.values[`${role}_agent_model`]);
  const prompt = String(s.values[`${role}_agent_prompt`]);
  return (
    <ScopeDrawer
      key={`${scope}:${model}:${prompt}`}
      agentId={scope}
      name={name}
      role={role}
      tools={allow}
      model={model}
      prompt={prompt}
      section={{
        policy_agent_model: String(s.values.policy_agent_model),
        policy_agent_prompt: String(s.values.policy_agent_prompt),
        refund_agent_model: String(s.values.refund_agent_model),
        refund_agent_prompt: String(s.values.refund_agent_prompt),
      }}
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
