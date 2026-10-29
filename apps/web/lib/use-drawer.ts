"use client";

import { useRouter } from "next/navigation";
import { type RefObject, useEffect } from "react";

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled])";

/**
 * A route-driven drawer's keyboard behaviour: focus `initial` on open, Escape goes to `closeHref`,
 * Tab stays inside, and on close focus returns to the opener (or `#fallbackId` if it is gone).
 */
export function useDrawer(ref: RefObject<HTMLElement | null>, opts: { closeHref: string; initial: string; fallbackId: string }) {
  const router = useRouter();
  const { closeHref, initial, fallbackId } = opts;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current!;
    el.querySelector<HTMLElement>(initial)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(closeHref, { scroll: false });
      } else if (e.key === "Tab") {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (opener?.isConnected ? opener : document.getElementById(fallbackId))?.focus();
    };
  }, [ref, router, closeHref, initial, fallbackId]);
}
