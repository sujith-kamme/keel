import { NextResponse } from "next/server";
import { currentCustomer } from "@/lib/customer";
import { captureCheckout, KeelError } from "@/lib/keel";
import { CaptureBody } from "@/lib/store-input";

/** Takes the payment once the shopper approves it in PayPal's window, and records the order. */
export async function POST(request: Request) {
  const email = await currentCustomer();
  if (!email) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = CaptureBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const order = await captureCheckout(email, body.data.order_id);
    return NextResponse.json({ order_id: order.order_id });
  } catch (err) {
    if (err instanceof KeelError && (err.status === 404 || err.status === 409)) return NextResponse.json({ error: "not_paid" }, { status: 409 });
    console.error("store capture failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
