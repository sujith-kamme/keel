import Link from "next/link";

export function AddToGauntlet({ sessionId, className = "b xs" }: { sessionId: string; className?: string }) {
  return (
    <Link href={`/context/learn?session=${encodeURIComponent(sessionId)}`} className={className}>
      Add to Gauntlet
    </Link>
  );
}
