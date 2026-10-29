import { NextResponse } from "next/server";
import { currentCustomer } from "@/lib/customer";
import { ordersFor, startSession } from "@/lib/keel";
import { SessionBody } from "@/lib/store-input";
import { writeChatCookie } from "../cookie";

/** Starts a support chat about one of the signed-in shopper's orders. */
export async function POST(request: Request) {
  const email = await currentCustomer();
  if (!email) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = SessionBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const order = (await ordersFor(email)).find((o) => o.order_id === body.data.order_id);
    if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const started = await startSession(email, [order.order_id]);
    await writeChatCookie({
      session_id: started.session_id,
      token: started.capability_token,
      email,
      verified: true,
      expires_at: started.expires_at,
      orders: [{ order_id: order.order_id, total: `${order.total.currency} ${order.total.value}`, items: order.items.map((i) => i.title) }],
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("store session failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
