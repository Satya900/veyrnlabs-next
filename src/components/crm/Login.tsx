"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
export default function Login({
  configured,
  showDemo,
}: {
  configured: boolean;
  showDemo: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="crm-login">
      <header className="crm-login-header">
        <Logo eager href="/" />
        <ButtonLink href="/" variant="outline-sm">
          Back to website <span aria-hidden="true">↗</span>
        </ButtonLink>
      </header>
      <div className="crm-login-grid hero-grid">
        <section className="login-story">
          <p className="eyebrow">
            <span className="status-dot" /> Veyrn Labs workspace
          </p>
          <h1>
            Every lead.
            <br />
            Every client.
            <br />
            <span>One workspace.</span>
          </h1>
          <p className="hero-description">
            Manage your leads, build client relationships, and keep the next
            step in view. From the first conversation to a won deal.
          </p>
          <p className="hero-note">
            Your real estate leads, clients, and follow-ups in one workspace.
          </p>
        </section>
        <div className="login-form">
          <Eyebrow>Team sign in</Eyebrow>
          <h2>Welcome back.</h2>
          <p>Sign in to pick up where you left off.</p>
          {!configured && (
            <div className="crm-notice">
              Your workspace is ready for setup. Connect Supabase and add your
              first team account to enable sign-in.
            </div>
          )}
          <form
            method="post"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const form = new FormData(e.currentTarget);
              try {
                const res = await fetch("/api/crm/session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(Object.fromEntries(form)),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                router.push("/crm");
                router.refresh();
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Unable to sign in.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Work email
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                placeholder="you@veyrnlabs.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
              <Link href="/crm/reset" className="crm-account-text-button">
                Forgot password?
              </Link>
            </label>
            {error && (
              <p role="alert" className="crm-error">
                {error}
              </p>
            )}
            <Button variant="primary" disabled={busy || !configured}>
              {busy ? "Signing in…" : "Sign in →"}
            </Button>
          </form>
          <p className="crm-muted">
            New business? <Link href="/crm/signup">Create an account</Link>.
            Joining a team? Open the invitation link from your workspace owner.
          </p>
          {showDemo && (
            <Link className="crm-demo-link" href="/crm/demo">
              Explore with sample data ↗
            </Link>
          )}
        </div>
      </div>
      <footer className="crm-login-footer">
        <span>Veyrn Labs</span>
        <span>Leads / Clients / Follow-ups</span>
      </footer>
    </main>
  );
}
