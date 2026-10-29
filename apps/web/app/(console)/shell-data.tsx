import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { UserLabel } from "@/components/shell";
import { requireConsole, reviewQueue, settings } from "@/lib/operator";

// The layout's dynamic parts, each behind its own Suspense boundary. API failures render nothing (the page
// itself reports them); redirects and prerender signals are rethrown.

export async function ConsoleUser() {
  await connection();
  let email: string | null = null;
  try {
    email = (await requireConsole()).user;
  } catch (e) {
    unstable_rethrow(e);
  }
  return <UserLabel email={email} />;
}

export async function ReviewCount() {
  await connection();
  let n = 0;
  try {
    await requireConsole();
    n = (await reviewQueue()).length;
  } catch (e) {
    unstable_rethrow(e);
  }
  if (n === 0) return null;
  return (
    <span className="sb-count">
      {n}
      <span className="srr"> waiting</span>
    </span>
  );
}

export async function SandboxBadge() {
  await connection();
  let sandbox = false;
  try {
    await requireConsole();
    sandbox = (await settings()).status.paypal.mode === "sandbox";
  } catch (e) {
    unstable_rethrow(e);
  }
  if (!sandbox) return null;
  return (
    <span className="env">
      <span style={{ width: 6, height: 6, borderRadius: 9, background: "var(--warn-dot)" }} />
      Sandbox
    </span>
  );
}
