"use client";

import { useSyncExternalStore } from "react";
import { THEME_COOKIE } from "./theme-script";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const listeners = new Set<() => void>();

function preference(): ThemePreference {
  const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)`));
  return (m?.[1] as ThemePreference | undefined) ?? "system";
}

// The <head> script owns the class (including OS changes under "system"); watch it rather than duplicate that.
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    listeners.delete(onChange);
    observer.disconnect();
  };
}

const snapshot = () => `${preference()} ${document.documentElement.classList.contains("dark") ? "dark" : "light"}`;

export function setTheme(theme: ThemePreference) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax${secure}`;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  listeners.forEach((l) => l());
}

/** The saved preference, the theme actually showing, and a setter that persists it in the keel_theme cookie. */
export function useTheme(): { theme: ThemePreference; resolved: ResolvedTheme; setTheme: typeof setTheme } {
  const [theme, resolved] = useSyncExternalStore(subscribe, snapshot, () => "system light").split(" ") as [ThemePreference, ResolvedTheme];
  return { theme, resolved, setTheme };
}
