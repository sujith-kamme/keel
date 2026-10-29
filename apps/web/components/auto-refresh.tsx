"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/** Refreshes `ms` after the previous refresh finished, so a slow render never stacks requests. */
export function AutoRefresh({ ms }: { ms: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (pending) return;
    const t = setTimeout(() => startTransition(() => router.refresh()), ms);
    return () => clearTimeout(t);
  }, [router, ms, pending]);
  return null;
}
