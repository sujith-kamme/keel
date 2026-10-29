"use client";

import { useTheme } from "@/lib/use-theme";

/** Flips between light and dark; the label names the theme it switches to, as in the designs. */
export function ThemeToggle({ className, small }: { className: string; small?: boolean }) {
  const { resolved, setTheme } = useTheme();
  return (
    <button type="button" className={className} onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}>
      <i className={small ? "ic ic-moon s14" : "ic ic-moon"} aria-hidden="true" />
      {resolved === "dark" ? "Light theme" : "Dark theme"}
    </button>
  );
}
