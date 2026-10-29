import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { buildDisputeRows } from "@/lib/disputes-view";
import { disputes, requireConsole } from "@/lib/operator";
import { DisputeTools, DisputesGrid } from "./disputes-grid";

async function List() {
  await connection();
  await requireConsole();
  const rows = buildDisputeRows(await disputes());
  if (rows.length === 0) return <p className="mt-4 text-sm">No disputes yet. New PayPal disputes show up here within a few minutes.</p>;
  return <DisputesGrid rows={rows} />;
}

export default function Page() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Disputes</h1>
      <p className="mt-1 text-sm opacity-80">
        Keel matches each PayPal dispute to the ledger, then defends it with evidence, concedes it, or asks you to decide.
      </p>
      <DisputeTools />
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <List />
      </Suspense>
      <AutoRefresh ms={3000} />
    </section>
  );
}
