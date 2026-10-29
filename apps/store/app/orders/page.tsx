import Link from "next/link";
import { requireCustomer } from "@/lib/customer";
import { catalog, ordersFor } from "@/lib/keel";
import { usd } from "@/lib/money";
import { orderStatus } from "@/lib/orders";

export default async function OrdersPage() {
  const email = await requireCustomer("/orders");
  const [orders, items] = await Promise.all([ordersFor(email), catalog()]);
  const image = new Map(items.map((i) => [i.sku, i.image_url]));
  return (
    <main className="shop-main" style={{ maxWidth: 1080 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 32, lineHeight: "40px", fontWeight: 500 }}>
        Your orders
      </h1>
      {orders.length === 0 ? (
        <div className="box">
          <div className="box-b mut">
            No orders yet.{" "}
            <Link href="/" style={{ textDecoration: "underline" }}>
              Start shopping
            </Link>
            .
          </div>
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          {orders.map((o) => {
            const st = orderStatus(o.delivered_at);
            const first = o.items[0];
            const img = first ? image.get(first.sku) : null;
            return (
              <li key={o.order_id} className="box" style={{ display: "flex", alignItems: "center", gap: 20, padding: "16px 20px", flexWrap: "wrap" }}>
                <div className="pimg" style={{ width: 72, aspectRatio: "1 / 1", borderRadius: 10, flex: "none" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog images */}
                  {img && <img src={img} alt="" />}
                </div>
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <div className="pname">
                    {first?.title ?? "Order"}
                    {o.items.length > 1 && <span className="dim"> and {o.items.length - 1} more</span>}
                  </div>
                  <div className="small dim">
                    Order <span className="mono">{o.order_id}</span>
                  </div>
                </div>
                <span className={st.delivered ? "chip-s ok" : "chip-s"}>{st.label}</span>
                <span className="price" style={{ minWidth: 80, textAlign: "right" }}>
                  {usd(o.total.value)}
                </span>
                <Link className="sbtn sm" href={`/orders/${encodeURIComponent(o.order_id)}`}>
                  View and get help
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
