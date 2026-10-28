import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Connects to Keel's MCP endpoint as the agent, with the session's capability token. */
export async function connectAgentTools(apiUrl: string, token: string) {
  const client = new Client({ name: "keel-demo-agent", version: "0.1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${apiUrl}/v1/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  const listed = await client.listTools();
  const tools: Anthropic.Tool[] = listed.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
  const callTool = async (name: string, input: unknown): Promise<string> => {
    const result = await client.callTool({ name, arguments: input as Record<string, unknown> });
    const text = (result.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text;
    if (result.isError || text === undefined) throw new Error(`Tool ${name} failed`);
    return text;
  };
  return { tools, callTool, close: () => client.close() };
}
