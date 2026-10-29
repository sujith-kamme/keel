"use client";

import Link from "next/link";
import { useBag } from "@/components/bag";
import { itemCount, MAX_QTY, setQty, subtotalCents } from "@/lib/bag";
import { usd } from "@/lib/money";

export default function BagPage() {
  const [bag, save] = useBag();
  const count = itemCount(bag);
  return (
    <main className="shop-main" style={{ maxWidth: 880 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 32, lineHeight: "40px", fontWeight: 500 }}>
        Your bag
      </h1>
      {bag.length === 0 ? (
        <div className="box">
          <div className="box-b mut">
            Your bag is empty.{" "}
            <Link href="/" style={{ textDecoration: "underline" }}>
              Keep shopping
            </Link>
            .
          </div>
        </div>
      ) : (
        <section className="box" aria-label="Items">
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {bag.map((l, i) => (
              <li key={`${l.sku}:${l.size}`} style={{ display: "flex", gap: 16, alignItems: "center", padding: "16px 20px", borderTop: i > 0 ? "1px solid var(--line)" : undefined, flexWrap: "wrap" }}>
                <div className="pimg" style={{ width: 72, aspectRatio: "1 / 1", borderRadius: 10, flex: "none" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog images */}
                  {l.image && <img src={l.image} alt="" />}
                </div>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <Link className="pname" href={`/p/${encodeURIComponent(l.sku)}`}>
                    {l.title}
                  </Link>
                  <div className="small dim">{l.size ? `Size ${l.size} · ` : ""}{usd(l.price)} each</div>
                </div>
                <label className="small mut" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Qty
                  <select className="sin" style={{ width: 72, height: 36 }} value={l.qty} onChange={(e) => save(setQty(bag, l.sku, l.size, Number(e.target.value)))}>
                    {Array.from({ length: MAX_QTY }, (_, n) => n + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="price" style={{ width: 88, textAlign: "right" }}>
                  {usd(Math.round(Number(l.price) * 100) * l.qty, true)}
                </span>
                <button type="button" className="sbtn sm" onClick={() => save(setQty(bag, l.sku, l.size, 0))} aria-label={`Remove ${l.title}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div style={{ borderTop: "1px solid var(--line)", padding: "16px 20px", display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
            <span>
              Subtotal · {count} {count === 1 ? "item" : "items"}
            </span>
            <span className="price">{usd(subtotalCents(bag), true)}</span>
          </div>
        </section>
      )}
    </main>
  );
}
