"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";

export function AccountForm({
  enabled,
  join = false,
}: {
  enabled: boolean;
  join?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"signup" | "verify" | "login">(
    join ? "login" : "signup",
  );
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function send(action: string, values: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const invitation = join ? window.location.hash.slice(1) : "";
      if (join && !/^[a-f0-9]{64}$/.test(invitation))
        throw new Error(
          "This invitation link is incomplete. Ask your workspace owner for a new link.",
        );
      const res = await fetch("/api/crm/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, email, invitation, action }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Account setup failed.");
      if (action === "signup") {
        setStep("verify");
        setMessage(result.message);
      } else if (action === "resend") setMessage(result.message);
      else {
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
            {join ? "Your team." : "Your business."}
            <br />
            Your leads.
            <br />
            <span>One workspace.</span>
          </h1>
          <p className="hero-description">
            {join
              ? "Use the email address your invitation was sent to. Your existing account can join only if it does not belong to another business."
              : "Create your account, verify your work email, and start organising your real estate pipeline."}
          </p>
          <p className="hero-note">
            Account creation does not start a paid subscription. Billing and AI
            activation are arranged separately.
          </p>
        </section>
        <section className="login-form crm-account-form">
          <h2>
            {step === "verify"
              ? "Verify your email."
              : step === "login"
                ? join
                  ? "Join your team."
                  : "Welcome back."
                : join
                  ? "Create your team account."
                  : "Create your workspace."}
          </h2>
          <p>
            {step === "verify"
              ? "Enter the code from your confirmation email. Keep this page open while checking your inbox."
              : "Your credentials stay private. Your team gets a shared workspace."}
          </p>
          {!enabled && (
            <p className="crm-notice">
              Registration is being prepared. Contact the Veyrn team for
              onboarding.
            </p>
          )}
          <form
            key={step}
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              void send(step, values);
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
            {step === "signup" && (
              <>
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                  />
                </label>
                {!join && (
                  <label>
                    Business name
                    <input
                      name="organization"
                      autoComplete="organization"
                      required
                      maxLength={150}
                    />
                  </label>
                )}
              </>
            )}
            {step !== "verify" ? (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    step === "signup" ? "new-password" : "current-password"
                  }
                  minLength={step === "signup" ? 12 : undefined}
                  maxLength={128}
                  required
                />
                {step === "signup" && (
                  <span className="crm-muted">At least 12 characters.</span>
                )}
              </label>
            ) : (
              <label>
                Verification code
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
                : step === "verify"
                  ? "Verify and continue →"
                  : step === "login"
                    ? "Sign in and join →"
                    : "Create account →"}
            </Button>
          </form>
          <div className="crm-account-actions">
            {step === "verify" && (
              <button
                className="crm-account-text-button"
                type="button"
                disabled={busy || !enabled}
                onClick={() => void send("resend")}
              >
                Resend verification code
              </button>
            )}
            <button
              className="crm-account-text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setStep(step === "login" ? "signup" : "login");
                setError("");
                setMessage("");
              }}
            >
              {step === "login" ? (
                <>
                  New here? <span>Create an account</span>
                </>
              ) : (
                <>
                  Already have an account? <span>Sign in</span>
                </>
              )}
            </button>
          </div>
          <p className="crm-muted crm-account-legal">
            Read our <Link href="/privacy">privacy policy</Link> and{" "}
            <Link href="/terms">terms</Link> before creating an account.
          </p>
        </section>
      </div>
    </main>
  );
}
