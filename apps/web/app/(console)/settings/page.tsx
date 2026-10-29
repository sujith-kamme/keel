import { EXTRACTOR_MODELS } from "@keel/extractor";
import { CUSTOMER_MODELS } from "@keel/gauntlet";
import Link from "next/link";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { requireConsole, settings, type SettingsStatus } from "@/lib/operator";
import { DisputesForm, EmailForm, GauntletForm, GuardForm, PasswordForm, SignOutEverywhere, ZapierCard } from "./forms";

function Section({ id, title, desc, children }: { id: string; title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <section className="st-sec" id={id} aria-labelledby={`${id}-h`}>
      <div>
        <h2 id={`${id}-h`}>{title}</h2>
        <p className="ds">{desc}</p>
      </div>
      {children}
    </section>
  );
}

function Deployed({ logo, name, desc, badge, last }: { logo: string; name: string; desc: ReactNode; badge: ReactNode; last?: boolean }) {
  return (
    <div className="intg" style={last ? undefined : { borderBottom: "1px solid var(--line-soft)" }}>
      <span className="lg" aria-hidden="true">
        {logo}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{name}</div>
        <div className="sm mut">{desc}</div>
      </div>
      {badge}
    </div>
  );
}

function SetAtDeploy({ status }: { status: SettingsStatus }) {
  const { paypal, anthropic, demo_otp } = status;
  return (
    <div className="pnl">
      <div className="pnl-h">
        <h2>Set at deploy</h2>
        <span className="sm dim">Change these in your host&apos;s environment</span>
      </div>
      <Deployed
        logo="P"
        name="PayPal"
        desc={
          <>
            {paypal.client_id ? (
              <>
                Client <span className="mono">{paypal.client_id}</span>
              </>
            ) : (
              "No client ID"
            )}
            {" · "}
            {paypal.webhook_configured ? "webhook configured" : "no webhook configured"}
          </>
        }
        badge={<span className={`bdg ${paypal.mode === "live" ? "ok" : "warn"}`}>{paypal.mode === "live" ? "Live" : "Sandbox"}</span>}
      />
      <Deployed
        logo="A"
        name="Anthropic"
        desc="API key for the agent, reply check and Gauntlet"
        badge={<span className={`bdg ${anthropic.key_set ? "ok" : "bad"}`}>{anthropic.key_set ? "Key set" : "Missing"}</span>}
      />
      <Deployed
        logo="#"
        name="Demo one-time codes"
        desc="Identity codes are returned in the API response instead of being sent. Demo only."
        badge={<span className={`bdg ${demo_otp ? "warn" : ""}`}>{demo_otp ? "On" : "Off"}</span>}
        last
      />
    </div>
  );
}

async function Sections() {
  await connection();
  const { user } = await requireConsole();
  const { values: v, zapier, status } = await settings();
  const n = (k: string) => v[k] as number;
  const s = (k: string) => v[k] as string;
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Section id="account" title="Account" desc="The console sign-in. Changing the password signs out every other session.">
        <div className="stk">
          <EmailForm email={user} />
          <PasswordForm />
          <SignOutEverywhere />
        </div>
      </Section>
      <Section
        id="guard"
        title="Guard"
        desc={
          <>
            How Keel checks agent replies and when it quarantines a conversation. Each agent&apos;s own model is set on <Link href="/agents">Agents</Link>.
          </>
        }
      >
        <GuardForm
          models={EXTRACTOR_MODELS}
          values={{ extractor_model: s("extractor_model"), extractor_timeout_ms: n("extractor_timeout_ms"), risk_threshold: n("risk_threshold"), risk_half_life_min: n("risk_half_life_min") }}
        />
      </Section>
      <Section id="gauntlet" title="Gauntlet" desc="Defaults for new Gauntlet runs. These don't affect certification.">
        <GauntletForm models={CUSTOMER_MODELS} values={{ gauntlet_customer_model: s("gauntlet_customer_model"), gauntlet_concurrency: n("gauntlet_concurrency") }} />
      </Section>
      <Section id="disputes" title="Disputes" desc="How Keel handles PayPal disputes it has classified.">
        <DisputesForm values={{ dispute_auto_submit: v.dispute_auto_submit === true, dispute_poll_seconds: n("dispute_poll_seconds") }} />
      </Section>
      <Section id="integrations" title="Integrations" desc="Services Keel talks to.">
        <div className="stk">
          <ZapierCard configured={zapier.configured} />
          <SetAtDeploy status={status} />
        </div>
      </Section>
    </div>
  );
}

export default function Page() {
  return (
    <>
      <div className="ph" style={{ maxWidth: 1080, width: "100%" }}>
        <div>
          <h1>Settings</h1>
        </div>
        <Link className="b" href="/ledger">
          Settings history
        </Link>
      </div>
      <div className="st-wrap">
        <nav className="st-nav" aria-label="Settings sections">
          <a href="#account">Account</a>
          <a href="#guard">Guard</a>
          <a href="#gauntlet">Gauntlet</a>
          <a href="#disputes">Disputes</a>
          <a href="#integrations">Integrations</a>
        </nav>
        <Suspense fallback={<p className="mut">Loading…</p>}>
          <Sections />
        </Suspense>
      </div>
    </>
  );
}
