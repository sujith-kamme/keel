"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useBag } from "@/components/bag";
import { itemCount, shippingCents, subtotalCents } from "@/lib/bag";
import { usd } from "@/lib/money";

interface PayPalButtons {
  render: (el: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
}
declare global {
  interface Window {
    paypal?: {
      Buttons: (opts: {
        style?: Record<string, string | number>;
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError: (err: unknown) => void;
      }) => PayPalButtons;
    };
  }
}

const post = (path: string, body: unknown) =>
  fetch(`/api/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function Checkout({ clientId, name }: { clientId: string; name: string }) {
  const router = useRouter();
  const [bag, save] = useBag();
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string>();
  const slot = useRef<HTMLDivElement>(null);
  // The PayPal button is rendered once; it reads the bag as it is when the shopper clicks.
  const lines = useRef(bag);
  useEffect(() => {
    lines.current = bag;
  });

  const subtotal = subtotalCents(bag);
  const shipping = shippingCents(subtotal);
  const empty = bag.length === 0;

  useEffect(() => {
    if (!sdkReady || empty || !slot.current || !window.paypal) return;
    const buttons = window.paypal.Buttons({
      style: { layout: "vertical", shape: "pill", label: "pay", height: 48 },
      createOrder: async () => {
        setError(undefined);
        const res = await post("checkout", { items: lines.current.map(({ sku, qty, size }) => ({ sku, qty, size })) });
        if (!res.ok) throw new Error("checkout");
        return ((await res.json()) as { id: string }).id;
      },
      onApprove: async ({ orderID }) => {
        const res = await post("checkout/capture", { order_id: orderID });
        if (!res.ok) return setError("PayPal didn't take the payment. Nothing was charged; try again.");
        save([]);
        router.push(`/orders?placed=${encodeURIComponent(orderID)}`);
      },
      onError: () => setError("Checkout isn't available right now. Nothing was charged; try again in a moment."),
    });
    void buttons.render(slot.current);
    return () => void buttons.close().catch(() => {});
  }, [sdkReady, empty, router, save]);

  if (empty) {
    return (
      <div className="box">
        <div className="box-b mut">
          Your bag is empty.{" "}
          <Link href="/" style={{ textDecoration: "underline" }}>
            Keep shopping
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="two" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 32 }}>
      <Script src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons&disable-funding=paylater`} onReady={() => setSdkReady(true)} />
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <section className="box" aria-labelledby="ship-h">
          <div className="box-h">
            <h2 id="ship-h" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
              Shipping to
            </h2>
          </div>
          <div className="box-b mut">
            {name}
            <br />
            214 Harbor Street, Apt 3
            <br />
            Portland, OR 97204
          </div>
        </section>
        <section className="box" aria-labelledby="pay-h">
          <div className="box-h">
            <h2 id="pay-h" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
              Payment
            </h2>
          </div>
          <div className="box-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="mut" style={{ margin: 0 }}>
              You&apos;ll approve the payment in a PayPal window, then come straight back here.
            </p>
            <div ref={slot} style={{ minHeight: 48 }}>
              {!sdkReady && <p className="small dim" style={{ margin: 0 }}>Loading PayPal…</p>}
            </div>
            {error && (
              <p role="alert" className="small" style={{ margin: 0, color: "var(--bad)" }}>
                {error}
              </p>
            )}
            <p className="small dim" style={{ margin: 0 }}>
              Sandbox: pay with a PayPal sandbox buyer account or test card. No real money moves.
            </p>
          </div>
        </section>
      </div>
      <aside className="box" aria-labelledby="sum-h">
        <div className="box-h">
          <h2 id="sum-h" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            Order summary
          </h2>
          <span className="small dim">
            {itemCount(bag)} {itemCount(bag) === 1 ? "item" : "items"}
          </span>
        </div>
        <div className="box-b" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {bag.map((l) => (
            <div key={`${l.sku}:${l.size}`} style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <div className="pimg" style={{ width: 64, aspectRatio: "1 / 1", borderRadius: 10, flex: "none" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog images */}
                {l.image && <img src={l.image} alt="" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pname">{l.title}</div>
                <div className="small dim">
                  {l.size ? `Size ${l.size} · ` : ""}Qty {l.qty}
                </div>
              </div>
              <span className="price">{usd(Math.round(Number(l.price) * 100) * l.qty, true)}</span>
            </div>
          ))}
          <div className="mut" style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Subtotal</span>
              <span className="price">{usd(subtotal, true)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Shipping</span>
              <span className="price">{shipping === 0 ? "Free" : usd(shipping, true)}</span>
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 17 }}>
            <span>Total</span>
            <span className="price">{usd(subtotal + shipping, true)}</span>
          </div>
          <p className="small dim" style={{ margin: 0 }}>
            Unused items can be refunded within 30 days of delivery, up to the amount you paid.
          </p>
        </div>
      </aside>
    </div>
  );
}
