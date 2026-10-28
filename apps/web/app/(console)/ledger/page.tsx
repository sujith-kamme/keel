import { connection } from "next/server";
import { Suspense } from "react";
import { ledgerPage } from "@/lib/operator";
import { LedgerGrid } from "./ledger-grid";

async function Entries() {
  await connection();
  const page = await ledgerPage();
  if (page.rows.length === 0) return <p className="mt-4 text-sm">No ledger entries yet. Every agent decision lands here.</p>;
  return <LedgerGrid initial={page} />;
}

export default function Page() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Ledger</h1>
      <p className="mt-1 text-sm opacity-80">Every decision Keel made, hash-chained so any edit after the fact shows up.</p>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Entries />
      </Suspense>
    </section>
  );
}
