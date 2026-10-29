"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "customer" | "agent";
  text: string;
}

const post = (path: string, body: unknown) =>
  fetch(`/api/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const bubble = (role: Message["role"]): React.CSSProperties =>
  role === "customer"
    ? { alignSelf: "flex-end", maxWidth: "80%", background: "var(--accent)", color: "#FFFFFF", borderRadius: "14px 14px 4px 14px", padding: "10px 14px", whiteSpace: "pre-wrap" }
    : { alignSelf: "flex-start", maxWidth: "80%", background: "#F1EDE6", borderRadius: "14px 14px 14px 4px", padding: "10px 14px", whiteSpace: "pre-wrap" };

/** The support assistant for one order: a Keel session scoped to that order, verified by the shopper's sign-in. */
export function SupportChat({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"connecting" | "ready" | "ended" | "failed">("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const log = useRef<HTMLDivElement>(null);

  // Resolves to whether support could be reached.
  const open = () =>
    post("session", { order_id: orderId })
      .then((res) => res.ok)
      .catch(() => false);

  const apply = (ok: boolean) => setState(ok ? "ready" : "failed");

  function start() {
    setState("connecting");
    setMessages([]);
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
      const { reply } = (await res.json()) as { reply: string };
      setMessages((m) => [...m, { role: "agent", text: reply }]);
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
        {state === "ready" && <span className="chip-s ok">Verified</span>}
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
            {messages.map((m, i) => (
              <div key={i} style={bubble(m.role)}>
                {m.text}
              </div>
            ))}
            {sending && (
              <div style={bubble("agent")} className="dim">
                Typing…
              </div>
            )}
          </>
        )}
      </div>

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
