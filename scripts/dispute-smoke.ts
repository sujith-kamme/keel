// Phase 6 exit check, through Keel's API only (no PayPal or Anthropic keys).
//
//   npm run smoke:dispute -- <defendCaseId> <concedeCaseId>            # classified and acted on
//   npm run smoke:dispute -- <defendCaseId> <concedeCaseId> --resolve  # then escalate and win the defended one
//
// PayPal reviews a new dispute for a few minutes before it allows any action, and
// offers adjudication about 30 minutes after claim-stage evidence (sandbox).
const { KEEL_API_URL, KEEL_OPERATOR_KEY } = process.env;
if (!KEEL_API_URL || !KEEL_OPERATOR_KEY) throw new Error("KEEL_API_URL and KEEL_OPERATOR_KEY must be set");
const [defendId, concedeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!defendId || !concedeId) throw new Error("usage: smoke:dispute <defendCaseId> <concedeCaseId> [--resolve]");
const resolve = process.argv.includes("--resolve");

interface Detail { classification: string | null; action: string | null; action_error: string | null; outcome: string; status: string; offered: string[] }

async function api<T>(path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${KEEL_API_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${KEEL_OPERATOR_KEY}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as T };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

async function waitFor(id: string, label: string, done: (d: Detail) => boolean, minutes: number, nudge = true): Promise<Detail> {
  let last = "";
  for (const deadline = Date.now() + minutes * 60_000; Date.now() < deadline; await sleep(15_000)) {
    if (nudge) await api("/v1/disputes/lookup", { dispute_id: id });
    const { status, json } = await api<Detail>(`/v1/disputes/${encodeURIComponent(id)}`);
    if (status === 200) {
      const line = `${json.classification ?? "-"} / ${json.action ?? "-"} / ${json.status} / ${json.outcome}`;
      if (line !== last) console.log(`[${elapsed()}] ${id}: ${line}${json.action_error ? ` (${json.action_error})` : ""}`);
      last = line;
      if (done(json)) return json;
    }
  }
  throw new Error(`${id}: timed out waiting for ${label} (last: ${last || "not found"})`);
}

const settled = (d: Detail) => ["EVIDENCE_SUBMITTED", "CLAIM_ACCEPTED", "FAILED", "AWAITING_OPERATOR"].includes(d.action ?? "");
const [defend, concede] = await Promise.all([
  waitFor(defendId, "evidence", settled, 10),
  waitFor(concedeId, "claim accepted", settled, 10),
]);

const failures: string[] = [];
if (defend.classification !== "DEFEND" || defend.action !== "EVIDENCE_SUBMITTED") failures.push(`${defendId}: expected DEFEND + EVIDENCE_SUBMITTED, got ${defend.classification} + ${defend.action}`);
if (concede.classification !== "CONCEDE" || concede.action !== "CLAIM_ACCEPTED") failures.push(`${concedeId}: expected CONCEDE + CLAIM_ACCEPTED, got ${concede.classification} + ${concede.action}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`[${elapsed()}] defended and conceded`);

if (resolve) {
  const esc = await api(`/v1/disputes/${encodeURIComponent(defendId)}/sandbox/escalate`, {});
  console.log(`[${elapsed()}] escalate: ${esc.status}`);
  await waitFor(defendId, "adjudication offered", (d) => d.offered.includes("adjudicate"), 60);
  for (let attempt = 1; ; attempt++) {
    const adj = await api<{ error?: string }>(`/v1/disputes/${encodeURIComponent(defendId)}/sandbox/adjudicate`, { outcome: "SELLER_FAVOR" });
    console.log(`[${elapsed()}] adjudicate: ${adj.status} ${adj.json?.error ?? ""}`);
    if (adj.status === 200) break;
    if (attempt === 5) throw new Error("adjudicate kept failing");
    await sleep(30_000);
  }
  await waitFor(defendId, "WON", (d) => d.outcome !== "OPEN", 10);
  const final = (await api<Detail>(`/v1/disputes/${encodeURIComponent(defendId)}`)).json;
  if (final.outcome !== "WON") {
    console.error(`${defendId}: expected WON, got ${final.outcome}`);
    process.exit(1);
  }
  console.log(`[${elapsed()}] ${defendId} won`);
}
