import { NextResponse } from "next/server";
import { ordersFor, startSession } from "@/lib/keel";
import { SessionBody } from "@/lib/store-input";
import { writeChatCookie } from "../cookie";

export async function POST(request: Request) {
  const body = SessionBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const email = body.data.email;
  try {
    const orders = (await ordersFor(email)).map((o) => ({
      order_id: o.order_id,
      total: `${o.total.currency} ${o.total.value}`,
      items: o.items.map((i) => i.title),
      delivered_at: o.delivered_at,
    }));
    const started = await startSession(email, orders.map((o) => o.order_id));
    await writeChatCookie({
      session_id: started.session_id,
      token: started.capability_token,
      email,
      verified: false,
      expires_at: started.expires_at,
      orders: orders.map(({ order_id, total, items }) => ({ order_id, total, items })),
    });
    return NextResponse.json({ demo_otp: started.demo_otp, orders });
  } catch (err) {
    console.error("store session failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
