import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { listSessions } from "@/lib/keel";
import { requireConsole } from "@/lib/operator";

async function Sessions() {
  await connection();
  await requireConsole();
  const sessions = await listSessions(20);
  if (sessions.length === 0) {
    return (
      <p className="mt-4 text-sm">
        No sessions yet —{" "}
        <Link href="/store" className="underline">
          start one in the demo store
        </Link>
      </p>
    );
  }
  return (
    <table className="mt-4 w-full text-left text-sm">
      <thead>
        <tr className="border-b border-black/10 dark:border-white/10">
          <th className="py-2 pr-4 font-medium">Customer</th>
          <th className="py-2 pr-4 font-medium">Verified</th>
          <th className="py-2 pr-4 font-medium">State</th>
          <th className="py-2 pr-4 font-medium">Started</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.id} className="border-b border-black/5 dark:border-white/5">
            <td className="py-2 pr-4">{s.claimed_email}</td>
            <td className="py-2 pr-4">{s.verified ? "Yes" : "No"}</td>
            <td className="py-2 pr-4">{s.state}</td>
            <td className="py-2 pr-4">{new Date(s.created_at).toLocaleString()}</td>
            <td className="py-2">
              <Link href={`/sessions/${s.id}`} className="underline">
                View
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Page() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Live sessions</h1>
      <Suspense fallback="Loading…">
        <Sessions />
      </Suspense>
      <AutoRefresh ms={3000} />
    </section>
  );
}
