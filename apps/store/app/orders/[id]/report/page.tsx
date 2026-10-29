import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer";
import { ordersFor } from "@/lib/keel";
import { usd } from "@/lib/money";
import { ORDER_ID } from "@/lib/store-input";
import { Reasons } from "./reasons";

// PayPal handles disputes for PayPal payments; the case then reaches Keel through its dispute webhook and poll.
const RESOLUTION_CENTER = "https://www.sandbox.paypal.com/resolutioncenter";

export default async function ReportPage({ params }: PageProps<"/orders/[id]/report">) {
  const { id } = await params;
  if (!ORDER_ID.test(id)) notFound();
  const email = await requireCustomer(`/orders/${id}/report`);
  const order = (await ordersFor(email)).find((o) => o.order_id === id);
  if (!order) notFound();
  const href = `/orders/${encodeURIComponent(order.order_id)}`;
  return (
    <main className="shop-main" style={{ maxWidth: 640 }}>
      <nav className="small dim" aria-label="Breadcrumb">
        <Link href="/orders" className="dim">
          Orders
        </Link>
        {" / "}
        <Link href={href} className="dim mono">
          {order.order_id}
        </Link>
        {" / "}Report a problem
      </nav>
      <div>
        <h1 className="serif" style={{ margin: 0, fontSize: 30, lineHeight: "38px", fontWeight: 500 }}>
          Report a problem to PayPal
        </h1>
        <p className="mut" style={{ margin: "6px 0 0" }}>
          You paid with PayPal, so PayPal handles the case. We&apos;ll take you to their Resolution Center for this payment.
        </p>
      </div>
      <Reasons />
      <section className="box" aria-labelledby="n-h">
        <div className="box-h">
          <h2 id="n-h" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            What happens next
          </h2>
        </div>
        <ol className="box-b mut" style={{ margin: 0, paddingLeft: 40, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>PayPal opens in a new tab. Sign in with the account that paid.</li>
          <li>Choose this payment ({usd(order.total.value)}) and describe the problem.</li>
          <li>We&apos;re notified and respond to PayPal, usually within minutes.</li>
        </ol>
      </section>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <a className="sbtn pri" href={RESOLUTION_CENTER} target="_blank" rel="noopener noreferrer">
          Continue to PayPal ↗
        </a>
        <Link className="sbtn" href={href}>
          Ask support instead
        </Link>
      </div>
      <p className="small dim" style={{ margin: 0 }}>
        Sandbox: this opens PayPal&apos;s sandbox Resolution Center.
      </p>
    </main>
  );
}
