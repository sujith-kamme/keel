const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$39.95" from a decimal string or a cent count. */
export const usd = (v: string | number, cents = false): string => USD.format(cents ? Number(v) / 100 : Number(v));
