const MONEY = /^\d+(\.\d{1,2})?$/;

// Money is carried as decimal strings (PayPal's format) and compared as integer
// cents so no floating-point rounding can change a decision.
export function toCents(value: string): number {
  if (!MONEY.test(value)) throw new Error(`Invalid money value: ${JSON.stringify(value)}`);
  const [whole = "0", frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
