import { Suspense } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { paypalSandbox } from "@/lib/env";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  // Read from the web's own environment: this page renders before sign-in, so it can't ask the operator API.
  const sandbox = paypalSandbox();
  const api = process.env.KEEL_API_URL;
  return (
    <div style={{ flex: 1, minHeight: "100vh", background: "var(--canvas)", display: "flex", flexDirection: "column", position: "relative" }}>
      <div style={{ position: "absolute", top: 16, right: 20 }}>
        <ThemeToggle className="b ghost" small />
      </div>

      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, width: "100%", boxSizing: "border-box" }}>
        <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, swapped by theme class */}
          <img src="/keel-logo-on-light-transparent.svg" alt="Keel" width={150} height={44} className="block dark:hidden" style={{ width: 150, height: 44 }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/keel-logo-on-dark-transparent.svg" alt="Keel" width={150} height={44} className="hidden dark:block" style={{ width: 150, height: 44 }} />
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, textAlign: "center" }}>Sign in to your console</h1>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </main>

      <footer className="sm dim" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, padding: 20, width: "100%", boxSizing: "border-box" }}>
        {sandbox && <span className="env">Sandbox environment</span>}
        {api && (
          <a href={`${api}/docs`} style={{ color: "var(--text-3)" }}>
            API reference
          </a>
        )}
      </footer>
    </div>
  );
}
