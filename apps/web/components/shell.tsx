"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ReactNode, Suspense, useState } from "react";
import { logout } from "@/app/login/actions";
import { ThemeToggle } from "./theme-toggle";

type Item = { href: string; label: string; icon: string; count?: boolean };

const SECTIONS: { title?: string; items: Item[] }[] = [
  { items: [{ href: "/", label: "Overview", icon: "overview" }] },
  {
    title: "Govern",
    items: [
      { href: "/policies", label: "Policies", icon: "policies" },
      { href: "/agents", label: "Agents", icon: "agents" },
      { href: "/context", label: "Context Mode", icon: "context" },
    ],
  },
  {
    title: "Operate",
    items: [
      { href: "/sessions", label: "Live sessions", icon: "sessions" },
      { href: "/review", label: "Review queue", icon: "review", count: true },
      { href: "/disputes", label: "Disputes", icon: "disputes" },
      { href: "/ledger", label: "Ledger", icon: "ledger" },
    ],
  },
];

const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

function title(pathname: string): string {
  if (isActive("/settings", pathname)) return "Settings";
  for (const s of SECTIONS) for (const i of s.items) if (isActive(i.href, pathname)) return i.label;
  return "Console";
}

function Pathname({ children }: { children: (pathname: string) => ReactNode }) {
  return children(usePathname());
}

/** usePathname() blocks prerendering on dynamic routes, so the active state streams in behind a fallback. */
const AtPath = ({ children }: { children: (pathname: string) => ReactNode }) => (
  <Suspense fallback={children("")}>
    <Pathname>{children}</Pathname>
  </Suspense>
);

const Mark = () => (
  <span className="sb-logo">
    <svg width="15" height="13" viewBox="0 0 24 20" aria-hidden="true">
      <path d="M1 2h22l-2 4h-7l-3 12H7l3-12H3z" fill="currentColor" />
    </svg>
  </span>
);

/**
 * The console frame from the v3 boards. `user`, `reviewCount` and `env` are server-rendered slots
 * (Suspense-wrapped in the layout) since they need the session and the API.
 */
export function ConsoleShell({ user, reviewCount, env, children }: { user: ReactNode; reviewCount: ReactNode; env: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className={open ? "shell open" : "shell"}>
      <div className="sb-mbar">
        <Mark />
        <span>Keel</span>
        <button type="button" className="ib" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="console-nav" onClick={() => setOpen(!open)}>
          <i className="ic ic-menu" aria-hidden="true" />
        </button>
      </div>
      <nav id="console-nav" className="sb" aria-label="Console">
        <div className="sb-in">
          <div className="sb-ws static">
            <Mark />
            <span style={{ fontWeight: 600, fontSize: 13 }}>Keel</span>
          </div>
          <div style={{ height: 8 }} />
          <AtPath>
            {(pathname) =>
              SECTIONS.map((s) => (
                <Fragment key={s.title ?? "top"}>
                  {s.title && <div className="sb-sec">{s.title}</div>}
                  {s.items.map((i) => {
                    const on = isActive(i.href, pathname);
                    return (
                      <Link key={i.href} href={i.href} className={on ? "sb-item on" : "sb-item"} aria-current={on ? "page" : undefined} onClick={close}>
                        <i className={`ic ic-${i.icon}`} aria-hidden="true" />
                        {i.label}
                        {i.count && reviewCount}
                      </Link>
                    );
                  })}
                </Fragment>
              ))
            }
          </AtPath>
          <div className="sb-foot">
            <ThemeToggle className="sb-btn" />
            <form action={logout}>
              <button type="submit" className="sb-btn">
                <i className="ic ic-logout" aria-hidden="true" />
                Sign out
              </button>
            </form>
            <div className="sb-user">
              {user}
              <AtPath>
                {(pathname) => (
                  <Link
                    href="/settings"
                    aria-label="Settings"
                    aria-current={isActive("/settings", pathname) ? "page" : undefined}
                    onClick={close}
                    style={{ marginLeft: "auto", color: "#A1A1AA", display: "flex" }}
                  >
                    <i className="ic ic-settings" aria-hidden="true" />
                  </Link>
                )}
              </AtPath>
            </div>
          </div>
        </div>
      </nav>
      <div className="mn">
        <header className="tb">
          <div className="crumb">
            <AtPath>{(pathname) => <b>{title(pathname)}</b>}</AtPath>
          </div>
          {env}
        </header>
        <main className="pg">{children}</main>
      </div>
    </div>
  );
}

/** Avatar initial, email and role for the sidebar footer. */
export function UserLabel({ email }: { email: string | null }) {
  return (
    <>
      <span className="sb-av">{email?.[0]?.toUpperCase()}</span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: "16px", minWidth: 0 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email ?? "Signed in"}</span>
        <span style={{ fontSize: 11, color: "#71717A" }}>Operator</span>
      </span>
    </>
  );
}
