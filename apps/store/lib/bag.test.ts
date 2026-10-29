import { describe, expect, it } from "vitest";
import { addLine, itemCount, MAX_QTY, parseBag, setQty, shippingCents, subtotalCents } from "./bag";

const jacket = { sku: "SKU-1", size: "M", title: "Torrent Rain Jacket", image: null, price: "39.95" };
const bottle = { sku: "SKU-2", size: null, title: "Classic Water Bottle", image: null, price: "13.99" };

describe("bag", () => {
  it("adds a line, then bumps it; another size is another line", () => {
    let bag = addLine([], jacket);
    bag = addLine(bag, jacket);
    bag = addLine(bag, { ...jacket, size: "L" });
    expect(bag.map((l) => [l.size, l.qty])).toEqual([
      ["M", 2],
      ["L", 1],
    ]);
  });

  it("caps the quantity", () => {
    let bag = addLine([], bottle);
    for (let i = 0; i < 20; i++) bag = addLine(bag, bottle);
    expect(bag[0]!.qty).toBe(MAX_QTY);
    expect(setQty(bag, "SKU-2", null, 99)[0]!.qty).toBe(MAX_QTY);
  });

  it("removes a line at quantity 0", () => {
    const bag = addLine(addLine([], jacket), bottle);
    expect(setQty(bag, "SKU-1", "M", 0).map((l) => l.sku)).toEqual(["SKU-2"]);
  });

  it("counts items and sums in cents", () => {
    const bag = setQty(addLine(addLine([], jacket), bottle), "SKU-1", "M", 2);
    expect(itemCount(bag)).toBe(3);
    expect(subtotalCents(bag)).toBe(2 * 3995 + 1399);
  });

  it("drops malformed stored lines", () => {
    const good = { ...jacket, qty: 1 };
    const raw = JSON.stringify([good, { ...good, qty: 0 }, { ...good, price: "1e3" }, { sku: 1 }, null]);
    expect(parseBag(raw)).toEqual([good]);
    expect(parseBag("not json")).toEqual([]);
    expect(parseBag(null)).toEqual([]);
  });

  it("charges $4 shipping under $50", () => {
    expect(shippingCents(4999)).toBe(400);
    expect(shippingCents(5000)).toBe(0);
  });
});
