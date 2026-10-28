import Link from "next/link";

export function AddToGauntlet({ sessionId }: { sessionId: string }) {
  return (
    <Link href={`/context/learn?session=${encodeURIComponent(sessionId)}`} className="rounded border border-black/20 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">
      Add to Gauntlet
    </Link>
  );
}
