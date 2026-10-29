import { AGENT_MODELS, PROMPT_MODES } from "@keel/agent";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { KillSwitch } from "@/components/kill-switch";
import { agentControl, type AgentControl, policies, requireConsole, settings } from "@/lib/operator";
import { agentLimits } from "@/lib/settings-view";
import { ScopeDrawer } from "./scope-drawer";

function Status({ c }: { c: AgentControl }) {
  return (
    <>
      <p className="mt-1 text-sm">
        <span className={`rounded px-2 py-0.5 text-xs ${c.frozen ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"}`}>
          {c.frozen ? "Frozen" : "Active"}
        </span>
      </p>
      <p className="mt-1 text-xs opacity-70">{c.updated_at ? `Last change by ${c.updated_by ?? "unknown"} at ${new Date(c.updated_at).toLocaleString()}` : "No changes yet"}</p>
    </>
  );
}

async function Agents() {
  await connection();
  await requireConsole();
  const [agent, all] = await Promise.all([agentControl("agt_demo_store"), agentControl("*")]);
  return (
    <div className="mt-4 flex max-w-xl flex-col gap-6">
      <div className="rounded border border-black/10 p-4 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">agt_demo_store</h2>
          <Link id="edit-scope" href="/agents?scope=agt_demo_store" scroll={false} className="text-sm">
            Edit scope
          </Link>
        </div>
        <Status c={agent} />
        <div className="mt-3">
          <KillSwitch agentId="agt_demo_store" frozen={agent.frozen} label="agent" />
        </div>
      </div>
      <div className="rounded border border-red-600/40 p-4">
        <h2 className="font-medium">Emergency: all agents</h2>
        <Status c={all} />
        <div className="mt-3">
          <KillSwitch agentId="*" frozen={all.frozen} label="all agents" danger />
        </div>
      </div>
    </div>
  );
}

/** The scope drawer, route-driven: /agents?scope=agt_demo_store. The model and prompt are global settings. */
async function Scope({ searchParams }: { searchParams: PageProps<"/agents">["searchParams"] }) {
  await connection();
  const { scope } = await searchParams;
  if (scope !== "agt_demo_store") return null;
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

export default function Page({ searchParams }: PageProps<"/agents">) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Agents</h1>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Agents />
      </Suspense>
      <Suspense>
        <Scope searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
