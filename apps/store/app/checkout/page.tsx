import { env } from "@/lib/env";
import { requireCustomer } from "@/lib/customer";
import { customerName } from "@/lib/store-input";
import { Checkout } from "./checkout";

export default async function CheckoutPage() {
  const email = await requireCustomer("/checkout");
  return (
    <main className="shop-main" style={{ maxWidth: 1080 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 32, lineHeight: "40px", fontWeight: 500 }}>
        Checkout
      </h1>
      <Checkout clientId={env().paypalClientId} name={customerName(email)} />
    </main>
  );
}
