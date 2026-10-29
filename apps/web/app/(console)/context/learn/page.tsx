import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { isSessionId } from "@/lib/review-view";
import { Editor } from "./editor";
import { requireConsole } from "@/lib/operator";

async function Body({ search }: { search: Promise<{ session?: string | string[] }> }) {
  await connection();
  await requireConsole();
  const sp = await search;
  const session = Array.isArray(sp.session) ? sp.session[0] : sp.session;
  return isSessionId(session) ? <Editor sessionId={session} /> : <p className="mt-4 text-sm">Invalid session.</p>;
}

export default function Page({ searchParams }: { searchParams: Promise<{ session?: string | string[] }> }) {
  return (
    <section>
      <Link href="/context" className="text-sm underline">
        ← Back to Simulations
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Add to Gauntlet</h1>
      <Suspense fallback={<p className="mt-4">Loading…</p>}>
        <Body search={searchParams} />
      </Suspense>
    </section>
  );
}
