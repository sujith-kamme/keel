import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Capability, MONEY, verifyToken } from "@keel/engine";
import type { Hono } from "hono";
import { z } from "zod";
import type { ToolCall, ToolResult } from "../gateway/handle";

export interface McpOptions {
  signingKey: string;
  now: () => Date;
  handle: (cap: Capability, call: ToolCall) => Promise<ToolResult>;
}

// Same shape PayPal ids are checked against in @keel/paypal.
const OrderId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const PolicyId = z.string().regex(/^[a-z0-9-]{1,64}$/);
const Reason = z.string().min(1).max(500);

const QUOTE = "Tell the customer the returned `message` verbatim.";

function buildServer(cap: Capability, opts: McpOptions): McpServer {
  const server = new McpServer({ name: "keel", version: "0.1.0" });
  const reply = async (call: ToolCall) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await opts.handle(cap, call)) }],
  });

  server.registerTool(
    "get_order",
    {
      description: "Look up an order in this conversation: items, total, refunded amount and delivery date.",
      inputSchema: { order_id: OrderId },
    },
    (args) => reply({ tool: "get_order", args }),
  );
  server.registerTool(
    "offer_refund",
    {
      description: `Request a refund on an order. Keel checks it against the merchant's policy and PayPal, and only refunds if it's allowed. Never promise a refund any other way. ${QUOTE}`,
      inputSchema: { order_id: OrderId, amount: z.string().regex(MONEY), reason: Reason, policy_id: PolicyId },
    },
    (args) => reply({ tool: "offer_refund", args }),
  );
  server.registerTool(
    "offer_discount",
    {
      description: `Request a discount code for the customer. Never offer discounts any other way. ${QUOTE}`,
      inputSchema: { percent: z.number().min(0).max(100), policy_id: PolicyId, order_id: OrderId.optional() },
    },
    (args) => reply({ tool: "offer_discount", args }),
  );
  server.registerTool(
    "state_policy",
    {
      description: `Get the merchant's approved wording for a policy. Quote it exactly; never paraphrase or invent policy. ${QUOTE}`,
      inputSchema: { policy_id: PolicyId },
    },
    (args) => reply({ tool: "state_policy", args }),
  );
  server.registerTool(
    "escalate_to_human",
    { description: `Hand the conversation to a person. ${QUOTE}`, inputSchema: { reason: Reason } },
    (args) => reply({ tool: "escalate_to_human", args }),
  );
  server.registerTool(
    "handoff_to_refund",
    {
      description: "Hand the conversation to the refunds specialist. Use it for any refund or discount request; you cannot refund or discount yourself.",
      inputSchema: { order_id: OrderId, reason: Reason },
    },
    (args) => reply({ tool: "handoff_to_refund", args }),
  );
  return server;
}

/** Stateless MCP over streamable HTTP; the capability token is the only credential (FR-MCP-1). */
export function mountMcp(app: Hono, opts: McpOptions): void {
  app.all("/v1/mcp", async (c) => {
    const token = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    const cap = token ? verifyToken(token, opts.signingKey, opts.now()) : null;
    if (!cap) return c.json({ error: "invalid_token" }, 401);

    const server = buildServer(cap, opts);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
