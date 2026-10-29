import { NextResponse } from "next/server";
import { currentCustomer } from "@/lib/customer";
import { createCheckout, KeelError } from "@/lib/keel";
import { CheckoutBody } from "@/lib/store-input";

/** Creates the PayPal order for the bag. Prices come from the server's catalog, not from here. */
export async function POST(request: Request) {
  const email = await currentCustomer();
  if (!email) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = CheckoutBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const order = await createCheckout(email, body.data.items);
    return NextResponse.json({ id: order.order_id });
  } catch (err) {
    if (err instanceof KeelError && err.status === 400) return NextResponse.json({ error: "unknown_item" }, { status: 400 });
    console.error("store checkout failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
