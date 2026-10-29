import { connection } from "next/server";
import { Suspense } from "react";
import { ledgerPage, requireConsole } from "@/lib/operator";
import { LedgerGrid, LedgerHeader } from "./ledger-grid";

async function Entries() {
  await connection();
  await requireConsole();
  const page = await ledgerPage();
  if (page.rows.length === 0)
    return (
      <>
        <LedgerHeader />
        <p className="mut">No ledger entries yet. Every agent decision lands here.</p>
      </>
    );
  return <LedgerGrid initial={page} />;
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <>
          <LedgerHeader />
          <p className="mut">Loading…</p>
        </>
      }
    >
      <Entries />
    </Suspense>
  );
}
