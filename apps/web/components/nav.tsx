import Link from "next/link";

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
      <span className="mb-4 text-lg font-semibold">Keel</span>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="rounded px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
