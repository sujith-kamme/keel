import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { policies, requireConsole } from "@/lib/operator";
import { ruleSummary } from "@/lib/policies-view";

async function List() {
  await connection();
  await requireConsole();
  const list = await policies();
  if (list.length === 0) return <p className="mt-4 text-sm">No policies yet. Run the policy seed.</p>;
  return (
    <ul className="mt-4 grid gap-4 lg:grid-cols-2">
      {list.map((p) => (
        <li key={p.policy_id}>
          <Link href={`/policies/${encodeURIComponent(p.policy_id)}`} className="block h-full rounded border border-black/10 p-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{p.policy_id}</h2>
              <span className="rounded bg-black/10 px-2 py-0.5 text-xs dark:bg-white/10">{p.type}</span>
              <span className="text-xs opacity-70">{p.active ? `v${p.active.version}` : "not approved"}</span>
              {p.draft && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Draft pending (v{p.draft.version})</span>}
            </div>
            {p.active && (
              <>
                <p className="mt-2 text-sm">{p.active.approved_text}</p>
                {p.active.rules.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm opacity-80">
                    {p.active.rules.map((r, i) => (
                      <li key={i}>{ruleSummary(r)}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Policies</h1>
      <p className="mt-1 text-sm opacity-80">What the agent may promise. The engine enforces the active version of each; drafts do nothing until approved.</p>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <List />
      </Suspense>
    </section>
  );
}
