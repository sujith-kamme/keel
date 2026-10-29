const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Delivered Sep 13", or "Processing" for an order that hasn't arrived yet. */
export function orderStatus(deliveredAt: string | null): { label: string; delivered: boolean } {
  const d = deliveredAt ? new Date(deliveredAt) : null;
  return d && !Number.isNaN(d.getTime()) ? { label: `Delivered ${DAY.format(d)}`, delivered: true } : { label: "Processing", delivered: false };
}
