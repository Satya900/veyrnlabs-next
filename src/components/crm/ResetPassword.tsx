"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";

export function ResetPassword({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function send(action: string, values: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/crm/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, email, action }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not reset your password.");
      if (action === "request-reset") {
        setStep("reset");
        setMessage(result.message);
      } else if (result.message) {
        setMessage(result.message);
      } else {
        router.push("/crm");
        router.refresh();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="crm-login">
      <header className="crm-login-header">
        <Logo eager href="/" />
        <Link href="/crm/login">Sign in ↗</Link>
      </header>
      <div className="crm-login-grid hero-grid">
        <section className="login-story">
          <p className="eyebrow">Veyrn CRM / Real estate</p>
          <h1>
            Reset your
            <br />
            <span>password.</span>
          </h1>
          <p className="hero-description">
            Enter your work email and we will send a reset code. Enter that
            code with a new password to sign back in.
          </p>
        </section>
        <section className="login-form crm-account-form">
          <h2>{step === "reset" ? "Enter your reset code." : "Forgot your password?"}</h2>
          <p>
            {step === "reset"
              ? "Check your inbox for the code, then choose a new password."
              : "We will email a reset code to your work address."}
          </p>
          {!enabled && (
            <p className="crm-notice">
              Password reset is being prepared. Contact the Veyrn team for
              help signing in.
            </p>
          )}
          <form
            key={step}
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              void send(step === "reset" ? "reset" : "request-reset", values);
            }}
          >
            <label>
              Work email
              <input
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
              />
            </label>
            {step === "reset" && (
              <>
                <label>
                  Reset code
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6,10}"
                    minLength={6}
                    maxLength={10}
                    required
                  />
                </label>
                <label>
                  New password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                  <span className="crm-muted">At least 12 characters.</span>
                </label>
              </>
            )}
            {error && (
              <p className="crm-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="crm-muted">
                {message}
              </p>
            )}
            <Button variant="primary" disabled={busy || !enabled}>
              {busy
                ? "Please wait…"
                : step === "reset"
                  ? "Set new password →"
                  : "Send reset code →"}
            </Button>
          </form>
          <div className="crm-account-actions">
            {step === "reset" && (
              <button
                className="crm-account-text-button"
                type="button"
                disabled={busy || !enabled}
                onClick={() => void send("request-reset")}
              >
                Resend reset code
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
