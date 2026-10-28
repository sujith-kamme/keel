import { connection } from "next/server";
import { ledgerExport, requireConsole } from "@/lib/operator";

// The ledger JSON export, streamed from the API with the operator key (never exposed to the browser).
export async function GET() {
  await connection();
  await requireConsole();
  return new Response(await ledgerExport(), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="keel-ledger.json"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
