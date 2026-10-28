import Link from "next/link";
import { logout } from "@/app/login/actions";

const items = [
  { href: "/", label: "Overview" },
  { href: "/policies", label: "Policies" },
  { href: "/agents", label: "Agents" },
  { href: "/context", label: "Context Mode" },
  { href: "/sessions", label: "Live sessions" },
  { href: "/review", label: "Review queue" },
  { href: "/ledger", label: "Ledger" },
  { href: "/disputes", label: "Disputes" },
] as const;

export function Nav() {
  return (
    <nav className="flex flex-col gap-1 p-4">
      <div className="mb-4">
        <img src="/keel-logo-on-light-transparent.svg" alt="Keel" className="h-7 w-auto dark:hidden" />
        <img src="/keel-logo-on-dark-transparent.svg" alt="Keel" className="hidden h-7 w-auto dark:block" />
      </div>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="rounded px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
          {item.label}
        </Link>
      ))}
      <form action={logout} className="mt-4">
        <button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10">Sign out</button>
      </form>
    </nav>
  );
}
