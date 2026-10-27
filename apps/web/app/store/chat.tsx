"use client";

import { useState } from "react";
import { DEMO_CUSTOMERS } from "@/lib/store-input";

interface Order {
  order_id: string;
  total: string;
  items: string[];
  delivered_at: string | null;
}
interface Message {
  role: "customer" | "agent";
  text: string;
}

const VERIFY_ERRORS: Record<string, string> = {
  wrong: "That code isn't right.",
  expired: "That code has expired. Pick the customer again.",
  locked: "Too many attempts. Pick the customer again.",
};

const post = (path: string, body: unknown) =>
  fetch(`/store/api/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function Chat() {
  const [connecting, setConnecting] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [otp, setOtp] = useState<string>();
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string>();

  async function pick(email: string) {
    setConnecting(true);
    setNotice(undefined);
    try {
      const res = await post("session", { email });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { demo_otp?: string; orders: Order[] };
      setOrders(data.orders);
      setOtp(data.demo_otp);
      setVerified(false);
      setVerifyError(undefined);
      setCode("");
      setMessages([]);
    } catch {
      setNotice("Could not connect. Please try again.");
    }
    setConnecting(false);
  }

  async function verify() {
    setVerifyError(undefined);
    setVerifying(true);
    try {
      const res = await post("verify", { code });
      if (res.ok) return setVerified(true);
      if (res.status === 401) return expire();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setVerifyError(VERIFY_ERRORS[data?.error ?? ""] ?? "Couldn't verify the code.");
    } catch {
      setVerifyError("Couldn't verify the code.");
    } finally {
      setVerifying(false);
    }
  }

  function expire() {
    setOrders(null);
    setNotice("Session expired — pick a customer again.");
  }

  async function send() {
    const sent = text.trim();
    if (!sent) return;
    setSending(true);
    setNotice(undefined);
    setMessages((m) => [...m, { role: "customer", text: sent }]);
    setText("");
    try {
      const res = await post("chat", { text: sent });
      if (res.status === 401) return expire();
      if (res.status === 429) return setNotice("Turn limit reached for this session.");
      if (!res.ok) throw new Error();
      const { reply } = (await res.json()) as { reply: string };
      setMessages((m) => [...m, { role: "agent", text: reply }]);
    } catch {
      setNotice("Message failed to send.");
    } finally {
      setSending(false);
    }
  }

  if (!orders) {
    return (
      <div>
        <p className="mb-3 text-sm">Who are you shopping as?</p>
        <div className="flex gap-3">
          {DEMO_CUSTOMERS.map((c) => (
            <button
              key={c.email}
              disabled={connecting}
              onClick={() => pick(c.email)}
              className="rounded border border-black/20 px-4 py-2 text-sm disabled:opacity-50 dark:border-white/20"
            >
              {c.name}
            </button>
          ))}
        </div>
        {connecting && <p className="mt-3 text-sm">Connecting… (the demo server may take up to a minute to wake up)</p>}
        {notice && <p className="mt-3 text-sm text-red-600">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">Your orders</h2>
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.order_id} className="rounded border border-black/10 p-3 text-sm dark:border-white/10">
              <span className="font-mono">{o.order_id}</span> · {o.total}
              <div className="text-black/60 dark:text-white/60">
                {o.items.join(", ")}
                {o.delivered_at && ` · delivered ${new Date(o.delivered_at).toLocaleDateString()}`}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="text-sm">
        {verified ? (
          <p className="font-medium text-green-700">Verified</p>
        ) : (
          <>
            {otp && <p className="mb-2 rounded bg-amber-100 p-2 text-amber-900">Demo: your verification code is {otp}</p>}
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code"
                className="rounded border border-black/20 px-2 py-1 dark:border-white/20"
              />
              <button
                onClick={verify}
                disabled={verifying || !/^\d{6}$/.test(code)}
                className="rounded border border-black/20 px-3 py-1 disabled:opacity-50 dark:border-white/20"
              >
                Verify
              </button>
            </div>
            {verifyError && <p className="mt-2 text-red-600">{verifyError}</p>}
          </>
        )}
      </section>

      <section>
        <div className="mb-3 space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "customer" ? "text-right" : "text-left"}>
              <span
                className={`inline-block max-w-[80%] whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                  m.role === "customer" ? "bg-black/10 dark:bg-white/10" : "border border-black/10 dark:border-white/10"
                }`}
              >
                {m.text}
              </span>
            </div>
          ))}
        </div>
        {notice && <p className="mb-2 text-sm text-red-600">{notice}</p>}
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            rows={2}
            disabled={sending}
            className="flex-1 rounded border border-black/20 px-2 py-1 text-sm dark:border-white/20"
          />
          <button onClick={send} disabled={sending} className="rounded border border-black/20 px-4 text-sm disabled:opacity-50 dark:border-white/20">
            Send
          </button>
        </div>
      </section>
    </div>
  );
}
