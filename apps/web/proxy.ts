import { NextResponse, type NextRequest } from "next/server";
import { CONSOLE_COOKIE, isConsoleSession } from "@/lib/console-auth";

/** Fails closed: a missing or short secret makes every check false. */
export function proxy(request: NextRequest) {
  let ok = false;
  try {
    ok = isConsoleSession(request.cookies.get(CONSOLE_COOKIE)?.value, process.env.KEEL_WEB_SECRET ?? "", new Date());
  } catch {}
  if (ok) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + search)}`, request.url));
}

export const config = {
  // `(?:/|$)` so only /login itself is public, not e.g. /loginx.
  // keel-*.svg and icon.svg are the public logo and favicon, needed on the login page.
  matcher: ["/((?!login(?:/|$)|_next/static|_next/image|favicon.ico|icon\\.svg$|keel-[\\w-]+\\.svg$).*)"],
};
