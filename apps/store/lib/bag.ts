// The shopping bag, kept in the browser. Titles, images and prices here are for display only:
// checkout prices every line from the catalog on the server.

export interface BagLine {
  sku: string;
  size: string | null;
  title: string;
  image: string | null;
  price: string;
  qty: number;
}

export const MAX_QTY = 10;

const same = (a: BagLine, sku: string, size: string | null) => a.sku === sku && a.size === size;

export function addLine(bag: BagLine[], line: Omit<BagLine, "qty">): BagLine[] {
  const found = bag.find((l) => same(l, line.sku, line.size));
  if (!found) return [...bag, { ...line, qty: 1 }];
  return bag.map((l) => (l === found ? { ...l, qty: Math.min(l.qty + 1, MAX_QTY) } : l));
}

/** A quantity of 0 removes the line. */
export function setQty(bag: BagLine[], sku: string, size: string | null, qty: number): BagLine[] {
  const n = Math.max(0, Math.min(Math.floor(qty), MAX_QTY));
  return bag.flatMap((l) => (same(l, sku, size) ? (n === 0 ? [] : [{ ...l, qty: n }]) : [l]));
}

export const itemCount = (bag: BagLine[]) => bag.reduce((n, l) => n + l.qty, 0);

/** Subtotal in cents, from the displayed prices. */
export const subtotalCents = (bag: BagLine[]) => bag.reduce((n, l) => n + Math.round(Number(l.price) * 100) * l.qty, 0);

const isLine = (v: unknown): v is BagLine => {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l.sku === "string" &&
    (l.size === null || typeof l.size === "string") &&
    typeof l.title === "string" &&
    (l.image === null || typeof l.image === "string") &&
    typeof l.price === "string" &&
    /^\d+(\.\d{1,2})?$/.test(l.price) &&
    Number.isInteger(l.qty) &&
    (l.qty as number) >= 1 &&
    (l.qty as number) <= MAX_QTY
  );
};

/** The stored bag, dropping anything malformed. */
export function parseBag(raw: string | null): BagLine[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter(isLine) : [];
  } catch {
    return [];
  }
}
