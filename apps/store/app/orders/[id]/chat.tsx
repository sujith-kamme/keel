"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "customer" | "agent" | "marker";
  text: string;
  agent_id?: string;
}

const VERIFY_ERRORS: Record<string, string> = {
  wrong: "That code isn't right.",
  expired: "That code has expired. Start a new chat.",
  locked: "Too many attempts. Start a new chat.",
};

const post = (path: string, body: unknown) =>
  fetch(`/api/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const bubble = (role: "customer" | "agent"): React.CSSProperties =>
  role === "customer"
    ? { alignSelf: "flex-end", maxWidth: "80%", background: "var(--accent)", color: "#FFFFFF", borderRadius: "14px 14px 4px 14px", padding: "10px 14px", whiteSpace: "pre-wrap" }
    : { alignSelf: "flex-start", maxWidth: "80%", background: "#F1EDE6", borderRadius: "14px 14px 14px 4px", padding: "10px 14px", whiteSpace: "pre-wrap" };

/** The support assistant for one order: a Keel session scoped to that order, with the identity code asked in the chat. */
export function SupportChat({ orderId, email }: { orderId: string; email: string }) {
  const [state, setState] = useState<"connecting" | "ready" | "ended" | "failed">("connecting");
  const [otp, setOtp] = useState<string>();
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const log = useRef<HTMLDivElement>(null);

  // Resolves to the demo code (if any), or null when support can't be reached.
  const open = () =>
    post("session", { order_id: orderId })
      .then(async (res) => (res.ok ? { otp: ((await res.json()) as { demo_otp?: string }).demo_otp } : null))
      .catch(() => null);

  const apply = (r: { otp?: string } | null) => {
    setOtp(r?.otp);
    setState(r ? "ready" : "failed");
  };

  function start() {
    setState("connecting");
    setMessages([]);
    setVerified(false);
    setCode("");
    setVerifyError(undefined);
    setNotice(undefined);
    void open().then(apply);
  }

  // Each order page opens a fresh chat about that order.
  useEffect(() => {
    void open().then(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, sending]);

  async function verify() {
    setVerifyError(undefined);
    setVerifying(true);
    try {
      const res = await post("verify", { code });
      if (res.ok) return setVerified(true);
      if (res.status === 401) return setState("ended");
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setVerifyError(VERIFY_ERRORS[data?.error ?? ""] ?? "Couldn't check the code.");
    } catch {
      setVerifyError("Couldn't check the code.");
    } finally {
      setVerifying(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const sent = text.trim();
    if (!sent || sending) return;
    setSending(true);
    setNotice(undefined);
    setMessages((m) => [...m, { role: "customer", text: sent }]);
    setText("");
    try {
      const res = await post("chat", { text: sent });
      if (res.status === 401) return setState("ended");
      if (res.status === 429) return setNotice("This chat has reached its message limit. Start a new chat.");
      if (!res.ok) throw new Error();
      const { replies } = (await res.json()) as { replies: { agent_id: string; text: string }[] };
      setMessages((m) => {
        const out = [...m];
        for (const r of replies) {
          const lastAgent = [...out].reverse().find((x) => x.role === "agent")?.agent_id;
          if (lastAgent && lastAgent !== r.agent_id && r.agent_id === "agt_refund") out.push({ role: "marker", text: "Refunds specialist joined" });
          out.push({ role: "agent", text: r.text, agent_id: r.agent_id });
        }
        return out;
      });
    } catch {
      setNotice("That message didn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="box" aria-labelledby="ch-h" style={{ display: "flex", flexDirection: "column", height: 640 }}>
      <div className="box-h">
        <div>
          <h2 id="ch-h" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            Support assistant
          </h2>
          <div className="small dim">AI assistant · replies checked against our policies</div>
        </div>
        {verified && <span className="chip-s ok">Verified</span>}
      </div>

      <div ref={log} aria-live="polite" style={{ flex: 1, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {state === "connecting" && <p className="mut" style={{ margin: 0 }}>Connecting to support… (the demo servers can take up to a minute to wake up)</p>}
        {state === "failed" && (
          <p className="mut" style={{ margin: 0 }}>
            Support isn&apos;t reachable right now.{" "}
            <button type="button" className="sbtn sm" onClick={start}>
              Try again
            </button>
          </p>
        )}
        {state === "ended" && (
          <p className="mut" style={{ margin: 0 }}>
            This chat has ended.{" "}
            <button type="button" className="sbtn sm" onClick={start}>
              Start a new chat
            </button>
          </p>
        )}
        {state === "ready" && (
          <>
            <div style={bubble("agent")}>Hi, I can help with order {orderId}. What&apos;s going on?</div>
            {messages.map((m, i) =>
              m.role === "marker" ? (
                <p key={i} role="status" className="small dim" style={{ textAlign: "center", margin: "4px 0" }}>
                  {m.text}
                </p>
              ) : (
                <div key={i} style={bubble(m.role)}>
                  {m.text}
                </div>
              ),
            )}
            {sending && (
              <div style={bubble("agent")} className="dim">
                Typing…
              </div>
            )}
          </>
        )}
      </div>

      {state === "ready" && !verified && (
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--line)", background: "var(--warn-bg)", display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="small">
            To refund or change this order, confirm it&apos;s you with the 6-digit code sent to <b>{email}</b>.
            {otp && <span className="dim"> Demo code: <span className="mono">{otp}</span></span>}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <label htmlFor="otp" className="srr">
              Verification code
            </label>
            <input id="otp" className="sin" style={{ height: 36, maxWidth: 160 }} value={code} onChange={(e) => setCode(e.target.value.trim())} inputMode="numeric" maxLength={6} placeholder="6-digit code" autoComplete="one-time-code" />
            <button type="button" className="sbtn sm" onClick={verify} disabled={verifying || !/^\d{6}$/.test(code)}>
              Verify
            </button>
          </div>
          {verifyError && (
            <span role="alert" className="small" style={{ color: "var(--bad)" }}>
              {verifyError}
            </span>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="small" style={{ margin: 0, padding: "8px 20px", color: "var(--bad)", borderTop: "1px solid var(--line)" }}>
          {notice}
        </p>
      )}
      <form onSubmit={send} style={{ padding: "14px 20px", borderTop: "1px solid var(--line)", display: "flex", gap: 10 }}>
        <label htmlFor="msg" className="srr">
          Message
        </label>
        <input id="msg" className="sin" placeholder="Write a message" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} disabled={state !== "ready"} />
        <button type="submit" className="sbtn pri" disabled={state !== "ready" || sending || !text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
