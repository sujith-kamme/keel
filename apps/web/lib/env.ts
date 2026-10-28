import "server-only";
import { agentModel, promptMode, type AgentModel, type PromptMode } from "@keel/agent";

export interface Env {
  keelApiUrl: string;
  merchantKey: string;
  operatorKey: string;
  anthropicKey: string;
  webSecret: string;
  consoleUser: string;
  consolePassword: string;
  model: AgentModel;
  promptMode: PromptMode;
}

let cached: Env | undefined;

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

/** Read and validated on first use, so `next build` does not need the environment. */
export function env(): Env {
  if (cached) return cached;
  const webSecret = required("KEEL_WEB_SECRET");
  if (Buffer.byteLength(webSecret) < 32) throw new Error("KEEL_WEB_SECRET must be at least 32 bytes");
  cached = {
    keelApiUrl: required("KEEL_API_URL"),
    merchantKey: required("KEEL_MERCHANT_KEY"),
    operatorKey: required("KEEL_OPERATOR_KEY"),
    anthropicKey: required("ANTHROPIC_API_KEY"),
    webSecret,
    consoleUser: required("CONSOLE_USER"),
    consolePassword: required("CONSOLE_PASSWORD"),
    model: agentModel(process.env.DEMO_AGENT_MODEL),
    promptMode: promptMode(process.env.DEMO_AGENT_PROMPT),
  };
  return cached;
}
