import { connection } from "next/server";
import { Suspense } from "react";
import { requireConsole } from "@/lib/operator";

async function Placeholder() {
  await connection();
  await requireConsole();
  return <p className="mut">Console settings are coming soon.</p>;
}

export default function Page() {
  return (
    <>
      <div className="ph">
        <div>
          <h1>Settings</h1>
        </div>
      </div>
      <Suspense>
        <Placeholder />
      </Suspense>
    </>
  );
}
