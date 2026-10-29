import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer";
import { catalog, ordersFor } from "@/lib/keel";
import { usd } from "@/lib/money";
import { orderStatus } from "@/lib/orders";
import { ORDER_ID } from "@/lib/store-input";
import { SupportChat } from "./chat";

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  if (!ORDER_ID.test(id)) notFound();
  const email = await requireCustomer(`/orders/${id}`);
  const [orders, items] = await Promise.all([ordersFor(email), catalog()]);
  // Another shopper's order looks the same as no order.
  const order = orders.find((o) => o.order_id === id);
  if (!order) notFound();
  const image = new Map(items.map((i) => [i.sku, i.image_url]));
  const st = orderStatus(order.delivered_at);
  return (
    <main className="shop-main" style={{ maxWidth: 1180 }}>
      <nav className="small dim" aria-label="Breadcrumb">
        <Link href="/orders" className="dim">
          Orders
        </Link>
        {" / "}
        <span className="mono">{order.order_id}</span>
      </nav>
      <div className="two" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.15fr)", gap: 28 }}>
        <section className="box" aria-labelledby="ord-h">
          <div className="box-h">
            <h1 id="ord-h" className="serif" style={{ margin: 0, fontSize: 22, lineHeight: "28px", fontWeight: 500 }}>
              Order <span className="mono">{order.order_id}</span>
            </h1>
            <span className={st.delivered ? "chip-s ok" : "chip-s"}>{st.label}</span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {order.items.map((i, n) => (
              <li key={n} className="box-b" style={{ display: "flex", gap: 14, alignItems: "center", borderTop: n > 0 ? "1px solid var(--line)" : undefined }}>
                <div className="pimg" style={{ width: 80, aspectRatio: "1 / 1", borderRadius: 10, flex: "none" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog images */}
                  {image.get(i.sku) && <img src={image.get(i.sku)!} alt="" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pname">{i.title}</div>
                  <div className="small dim">Paid with PayPal</div>
                </div>
                <span className="price">{usd(i.price)}</span>
              </li>
            ))}
          </ul>
          <div className="box-b" style={{ borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
            <span>Total</span>
            <span className="price">{usd(order.total.value)}</span>
          </div>
        </section>
        <SupportChat orderId={order.order_id} email={email} />
      </div>
    </main>
  );
}
