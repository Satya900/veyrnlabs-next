"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CRM_PLANS, type PlanId } from "@/lib/crm/plans";

export type Grant = {
  id: string;
  plan: PlanId;
  starts_at: string;
  ends_at: string;
  ai_limit: number;
  granted_by: string;
  note: string | null;
};

const DURATIONS = [
  { id: "14d", label: "14 days", days: 14 },
  { id: "1m", label: "1 month", months: 1 },
  { id: "3m", label: "3 months", months: 3 },
  { id: "6m", label: "6 months", months: 6 },
  { id: "12m", label: "1 year", months: 12 },
  { id: "custom", label: "Until a date" },
] as const;
type Duration = (typeof DURATIONS)[number]["id"];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
// yyyy-mm-dd in IST, for date inputs.
const isoDay = (date: Date) => new Date(date.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error ?? "That didn't work.");
  return result;
}

/**
 * Plan, start, length, AI allowance and note. Starting today means "from now"; a later start
 * (for example when current access ends) begins at midnight IST that day.
 */
function PlanFields({ earliest, busy, submit, children }: {
  earliest: string | null;
  busy: boolean;
  submit: string;
  children?: React.ReactNode;
}) {
  const [plan, setPlan] = useState<PlanId>("pro");
  const [duration, setDuration] = useState<Duration>("1m");
  const today = isoDay(new Date());
  const firstDay = earliest && earliest > new Date().toISOString() ? isoDay(new Date(earliest)) : today;
  return (
    <>
      {children}
      <label>
        Plan
        <select name="plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
          <option value="pro">Pro (1 user)</option>
          <option value="pro_plus">Pro Plus (3 users, AI auto-replies)</option>
        </select>
      </label>
      <label>
        Starts
        <input type="date" name="start" defaultValue={firstDay} min={firstDay} required />
      </label>
      <label>
        Length
        <select name="duration" value={duration} onChange={(e) => setDuration(e.target.value as Duration)}>
          {DURATIONS.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </label>
      {duration === "custom" && (
        <label>
          Ends on
          <input type="date" name="end" min={firstDay} required />
        </label>
      )}
      <label>
        AI actions a month
        <input
          key={plan}
          type="number"
          name="ai"
          min={1}
          max={100000}
          defaultValue={CRM_PLANS[plan].aiActions}
          required
        />
      </label>
      <label className="crm-grant-wide">
        Note <small>(only admins see it)</small>
        <input name="note" maxLength={500} placeholder="e.g. Partner pilot, paid by bank transfer" />
      </label>
      <button type="submit" className="crm-primary" disabled={busy} aria-busy={busy}>
        {busy ? "Saving…" : submit}
      </button>
    </>
  );
}

/** Reads PlanFields into the API's plan, startsAt, endsAt, aiActions and note. */
function planValues(form: FormData) {
  const start = String(form.get("start") ?? "");
  const duration = String(form.get("duration")) as Duration;
  const now = new Date();
  const startsToday = !start || start <= isoDay(now);
  const begins = startsToday ? now : new Date(`${start}T00:00:00+05:30`);
  let ends: Date;
  const preset = DURATIONS.find((d) => d.id === duration);
  if (duration === "custom") {
    const end = String(form.get("end") ?? "");
    if (!end) throw new Error("Choose the end date.");
    ends = new Date(`${end}T23:59:59+05:30`);
  } else if (preset && "days" in preset) {
    ends = new Date(begins.getTime() + preset.days * 86400e3);
  } else {
    ends = new Date(begins);
    ends.setMonth(ends.getMonth() + (preset && "months" in preset ? preset.months : 1));
  }
  if (ends <= begins) throw new Error("The end date must be after the start date.");
  return {
    plan: form.get("plan"),
    startsAt: startsToday ? null : begins.toISOString(),
    endsAt: ends.toISOString(),
    aiActions: Number(form.get("ai")),
    note: form.get("note"),
  };
}

/** New customer: a verified login, their workspace and a plan, in one step. */
export function CreateCustomer() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ email: string; plan: PlanId; ends: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const message = done
    ? `Your Veyrn CRM account is ready with ${CRM_PLANS[done.plan].name} until ${day(done.ends)}.\n\n` +
      `1. Open https://crm.veyrnlabs.com/crm/reset\n2. Enter ${done.email} and tap "Send reset code"\n` +
      `3. Enter the code from your email and choose a password. You'll be signed straight in.`
    : "";
  return (
    <section className="crm-panel crm-grant-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>Give a plan to a new customer</h2>
          <p>
            Creates their login and workspace with Pro or Pro Plus for the period you choose. No payment is
            taken and it isn&apos;t counted as revenue. For an existing customer, open their row below.
          </p>
        </div>
      </div>
      <form
        key={formKey}
        className="crm-grant-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          setDone(null);
          setCopied(false);
          try {
            const values = planValues(form);
            const result = await post({
              action: "create",
              name: form.get("name"),
              email: form.get("email"),
              business: form.get("business"),
              ...values,
            });
            setDone({ email: String(form.get("email")).trim().toLowerCase(), plan: result.grant.plan, ends: result.grant.ends_at });
            setFormKey((k) => k + 1);
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "That didn't work.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <PlanFields earliest={null} busy={busy} submit="Create account and give plan">
          <label>
            Name
            <input name="name" maxLength={100} required autoComplete="off" />
          </label>
          <label>
            Email
            <input type="email" name="email" maxLength={320} required autoComplete="off" />
          </label>
          <label>
            Business name
            <input name="business" maxLength={150} required autoComplete="off" />
          </label>
        </PlanFields>
      </form>
      {error && <p role="alert" className="crm-error crm-grant-msg">{error}</p>}
      {done && (
        <div role="status" className="crm-grant-done">
          <strong>Account created. Send them this:</strong>
          <pre>{message}</pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(message).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy message"}
          </button>
        </div>
      )}
    </section>
  );
}

/** In a customer's row: their current and upcoming grants, revoke, and grant another. */
export function WorkspaceGrants({ organizationId, grants, paidUntil }: {
  organizationId: string;
  grants: Grant[];
  paidUntil: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await post(body);
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="crm-grant-row">
      <div className="crm-grant-row-head">
        <strong>Granted plans</strong>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}>
            + Grant plan
          </button>
        )}
      </div>
      {grants.length ? (
        <ul>
          {grants.map((g) => (
            <li key={g.id}>
              <span>
                <strong>{CRM_PLANS[g.plan].name}</strong> · {day(g.starts_at)} to {day(g.ends_at)} ·{" "}
                {g.ai_limit.toLocaleString("en-IN")} AI actions a month
                <small>
                  by {g.granted_by}
                  {g.note ? ` · ${g.note}` : ""}
                </small>
              </span>
              <button
                type="button"
                className="crm-danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`End this ${CRM_PLANS[g.plan].name} grant now? Their access stops immediately.`))
                    void run({ action: "revoke", grantId: g.id });
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="crm-muted">None. Paid plans are managed by Razorpay.</p>
      )}
      {adding && (
        <form
          className="crm-grant-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              void run({ action: "grant", organizationId, ...planValues(new FormData(e.currentTarget)) });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Check the dates.");
            }
          }}
        >
          <PlanFields earliest={paidUntil} busy={busy} submit="Grant plan" />
          <button type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      )}
      {error && <p role="alert" className="crm-error">{error}</p>}
    </div>
  );
}
