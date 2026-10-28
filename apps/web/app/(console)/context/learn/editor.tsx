"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { LIMITS } from "@/lib/context-view";
import { draft, save } from "./actions";

type Scenario = Record<string, unknown>;

function Field({ label, value, onChange, max, rows }: { label: string; value: string; onChange: (v: string) => void; max: number; rows: number }) {
  return (
    <label className="block text-sm">
      {label}
      <textarea value={value} maxLength={max} rows={rows} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded border border-black/20 bg-transparent p-2 dark:border-white/20" />
      <span className="text-xs opacity-70">
        {value.length} / {max}
      </span>
    </label>
  );
}

const Readonly = ({ label, value }: { label: string; value: string }) => (
  <div className="text-sm">
    <span className="opacity-70">{label}: </span>
    {value}
  </div>
);

export function Editor({ sessionId }: { sessionId: string }) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState("");
  const [description, setDescription] = useState("");
  const [openers, setOpeners] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    draft(sessionId).then((r) => {
      if (!r.ok) return setError(r.message);
      const s = r.scenario;
      setPersona(String(s.persona ?? ""));
      setDescription(String(s.description ?? ""));
      setOpeners(Array.isArray(s.openers) ? s.openers.slice(0, 2).map(String) : []);
      setScenario(s);
    });
  }, [sessionId]);

  if (error) return <p className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>;
  if (!scenario) return <p className="mt-4 text-sm">Drafting a scenario from this session…</p>;

  const setup = scenario.setup as { fixture?: unknown } | undefined;
  const submit = () => {
    setError(null);
    start(async () => {
      const r = await save(sessionId, scenario, { persona, description, openers });
      setError(r.message);
    });
  };
  return (
    <form
      className="mt-4 flex max-w-2xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Readonly label="Id" value={String(scenario.id)} />
      <Readonly label="Pack" value={String(scenario.pack)} />
      <Readonly label="Fixture" value={String(setup?.fixture ?? "")} />
      <Readonly label="Expectations" value={JSON.stringify(scenario.expect)} />
      <Field label="Description" value={description} onChange={setDescription} max={LIMITS.description} rows={3} />
      <Field label="Persona" value={persona} onChange={setPersona} max={LIMITS.persona} rows={5} />
      {openers.map((o, i) => (
        <Field key={i} label={`Opener ${i + 1}`} value={o} onChange={(v) => setOpeners((cur) => cur.map((x, j) => (j === i ? v : x)))} max={LIMITS.opener} rows={3} />
      ))}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded border border-black/20 px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10">
          {pending ? "Saving…" : "Save scenario"}
        </button>
        {error && <span className="text-sm text-red-700 dark:text-red-300">{error}</span>}
      </div>
    </form>
  );
}
