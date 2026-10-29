import { connection } from "next/server";
import { Suspense } from "react";
import { KillSwitch } from "@/components/kill-switch";
import { agentControl, type AgentControl, requireConsole } from "@/lib/operator";

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
        <h2 className="font-medium">agt_demo_store</h2>
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

export default function Page() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Agents</h1>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Agents />
      </Suspense>
    </section>
  );
}
