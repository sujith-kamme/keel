// Phase 2a exit check: plays the agent against Keel over MCP. It reads only
// KEEL_API_URL and KEEL_MERCHANT_KEY, so run it with no PayPal credentials:
//
//   env -i PATH="$PATH" KEEL_API_URL=… KEEL_MERCHANT_KEY=… npm run smoke:mcp
//
// The in-policy order can be refunded once; reseed it with
// `npm run seed:store -- --fresh in-policy` before running again.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const API = process.env.KEEL_API_URL;
const MERCHANT_KEY = process.env.KEEL_MERCHANT_KEY;
if (!API || !MERCHANT_KEY) throw new Error("KEEL_API_URL and KEEL_MERCHANT_KEY must be set");
if (Object.keys(process.env).some((k) => k.startsWith("PAYPAL_"))) {
  throw new Error("PayPal credentials are in the environment; the agent side must run without them");
}

const merchant = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${MERCHANT_KEY}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed with ${res.status}`);
  return (await res.json()) as T;
};

type Orders = { orders: { order_id: string; scenario: string }[] };
// Latest order per scenario (fresh reseeds get a timestamp suffix).
const byScenario = (orders: Orders["orders"]) => {
  const map = new Map<string, string>();
  for (const o of [...orders].sort((a, b) => a.scenario.localeCompare(b.scenario))) {
    map.set(o.scenario.replace(/-\d+$/, ""), o.order_id);
  }
  return map;
};

async function connect(token: string) {
  const client = new Client({ name: "keel-smoke-agent", version: "0.1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${API}/v1/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
    return JSON.parse(text) as { decision: string; reason_code: string; message: string; data?: Record<string, unknown> };
  };
}

// Wake the free-tier service before timing-sensitive calls.
const health = await fetch(`${API}/health`, { signal: AbortSignal.timeout(90_000) });
console.log(`health: ${health.status}`);

const maya = byScenario((await merchant<Orders>("/v1/store/orders?customer_email=maya@gmail.com")).orders);
const sam = byScenario((await merchant<Orders>("/v1/store/orders?customer_email=sam@gmail.com")).orders);
const inPolicy = maya.get("in-policy")!;
const oldOrder = maya.get("out-of-window")!;
const large = maya.get("large-order")!;
const other = sam.get("other-customer")!;
if (!inPolicy || !oldOrder || !large || !other) throw new Error("Demo orders missing; run npm run seed:store");

const rows: { step: string; expected: string; actual: string; pass: boolean }[] = [];
const check = async (step: string, expected: string, call: Promise<{ decision: string; reason_code: string }>) => {
  const r = await call;
  const actual = `${r.decision} ${r.reason_code}`;
  rows.push({ step, expected, actual, pass: actual === expected });
  return r;
};
const refund = (order_id: string, amount: string) => ({ order_id, amount, reason: "smoke test", policy_id: "refund-standard" });

// A live session always starts at the policy agent, whatever agent_id is sent.
const startSession = () =>
  merchant<{ session_id: string; capability_token: string; demo_otp?: string; orders: string[] }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ agent_id: "agt_refund", customer_email: "maya@gmail.com", order_ids: [inPolicy, oldOrder, large, other] }),
  });
const handoff = async (sessionId: string, call: Awaited<ReturnType<typeof connect>>, label: string) => {
  await check(`${label}: handoff to refund`, "ALLOW OK", call("handoff_to_refund", { order_id: inPolicy, reason: "smoke test" }));
  const t = await merchant<{ agent_id: string; capability_token: string }>(`/v1/sessions/${sessionId}/token`, { method: "POST", body: "{}" });
  rows.push({ step: `${label}: session now at refund agent`, expected: "agt_refund", actual: t.agent_id, pass: t.agent_id === "agt_refund" });
  return t.capability_token;
};

// Each refusal adds to the session's risk score, and the checks below would cross the
// quarantine threshold in one session, so the refusals are split across two.

// The policy agent has no money tools; the refund agent can't hand off again, and its
// money tools still need the OTP after a handoff.
const scopeSession = await startSession();
const policy = await connect(scopeSession.capability_token);
await check("policy agent: refund", "BLOCK CAPABILITY_OUT_OF_SCOPE", policy("offer_refund", refund(inPolicy, "10.00")));
await check("policy agent: discount", "BLOCK CAPABILITY_OUT_OF_SCOPE", policy("offer_discount", { percent: 10, policy_id: "discount-goodwill" }));
const unverified = await connect(await handoff(scopeSession.session_id, policy, "scope"));
await check("refund agent: handoff again", "BLOCK CAPABILITY_OUT_OF_SCOPE", unverified("handoff_to_refund", { order_id: inPolicy, reason: "smoke test" }));
await check("refund before OTP", "BLOCK PAYER_NOT_VERIFIED", unverified("offer_refund", refund(inPolicy, "10.00")));
// Last in this session: a foreign order is the heaviest signal.
await check("another customer's order", "BLOCK CAPABILITY_OUT_OF_SCOPE", unverified("get_order", { order_id: other }));

const session = await startSession();
if (!session.demo_otp) throw new Error("DEMO_OTP must be enabled on the API");
const sessionPath = `/v1/sessions/${session.session_id}`;
await handoff(session.session_id, await connect(session.capability_token), "main");
const verified = await merchant<{ capability_token: string }>(`${sessionPath}/verify`, {
  method: "POST",
  body: JSON.stringify({ code: session.demo_otp }),
});
const agent = await connect(verified.capability_token);

const order = await check("get_order in-policy", "ALLOW OK", agent("get_order", { order_id: inPolicy }));
if (order.data?.refunded !== "0.00") throw new Error("In-policy order already refunded; run npm run seed:store -- --fresh in-policy");

await check("refund over capability cap ($130)", "BLOCK CAPABILITY_OUT_OF_SCOPE", agent("offer_refund", refund(large, "130.00")));
await check("refund outside window", "BLOCK OUTSIDE_WINDOW", agent("offer_refund", refund(oldOrder, "10.00")));
await check("refund over captured ($45 on $42)", "BLOCK AMOUNT_EXCEEDS_CAPTURED", agent("offer_refund", refund(inPolicy, "45.00")));
await check("refund above auto-approve ($80)", "HOLD ABOVE_AUTO_APPROVE", agent("offer_refund", refund(large, "80.00")));
await check("discount 25%", "BLOCK DISCOUNT_EXCEEDS_LIMIT", agent("offer_discount", { percent: 25, policy_id: "discount-goodwill" }));
await check("discount 10%", "ALLOW OK", agent("offer_discount", { percent: 10, policy_id: "discount-goodwill" }));
await check("state approved policy", "ALLOW OK", agent("state_policy", { policy_id: "policy-bereavement" }));
await check("state invented policy", "BLOCK POLICY_NOT_FOUND", agent("state_policy", { policy_id: "bereavement-90-days" }));
const executed = await check("in-policy refund ($42)", "ALLOW OK", agent("offer_refund", refund(inPolicy, "42.00")));
await check("same refund again", "BLOCK AMOUNT_EXCEEDS_CAPTURED", agent("offer_refund", refund(inPolicy, "42.00")));

console.table(rows);
console.log(`refund executed in PayPal Sandbox: ${JSON.stringify((executed as { data?: unknown }).data)}`);
const failed = rows.filter((r) => !r.pass).length;
console.log(failed ? `${failed} step(s) failed` : "all steps passed");
process.exit(failed ? 1 : 0);
