"use client";
import { crmFetch } from "./activity";
import { useState } from "react";
import { EXTRA_SEAT_PAISE, type UsageSummary } from "@/lib/crm/plans";
import { loadRazorpayScript } from "./Billing";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const seatStatus: Record<string, string> = {
  created: "Payment pending",
  authenticated: "Awaiting first charge",
  active: "Active",
  pending: "Payment retrying",
  halted: "Payment failed",
  cancelled: "Cancelled",
  completed: "Ended",
  expired: "Expired",
  paused: "Paused",
};

export function BillingManage({
  summary,
  reload,
  part = "all",
}: {
  summary: UsageSummary;
  reload: () => void;
  /** "actions" = plan checkout/renewal buttons only, "seats" = additional users only. */
  part?: "all" | "actions" | "seats";
}) {
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: string, subscriptionId?: string) {
    if (
      action === "cancel" &&
      !window.confirm(
        "Cancel this? An unpaid checkout is removed. For a paid subscription, renewal stops and already-paid access continues until its end date.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const response = await crmFetch("/api/crm/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, subscriptionId, quantity }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.subscriptionId) {
        await loadRazorpayScript();
        if (!window.Razorpay) throw new Error("Payment form unavailable.");
        new window.Razorpay({
          key: result.keyId,
          subscription_id: result.subscriptionId,
          name: "Veyrn CRM",
          handler: reload,
        }).open();
      } else setMessage(result.message || "Updated.");
      reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to update billing.",
      );
    } finally {
      setBusy(false);
    }
  }
  const renewable =
    summary.billing_status &&
    !["cancelled", "completed", "expired"].includes(summary.billing_status);
  const seats = summary.seat_subscriptions ?? [];
  return (
    <div className="crm-billing-manage">
      {part !== "seats" && (summary.billing_status === "created" || renewable) && (
        <div className="crm-billing-actions">
          {summary.billing_status === "created" && (
            <button className="crm-primary" disabled={busy} onClick={() => void act("resume")}>
              Resume checkout
            </button>
          )}
          {renewable && (
            <button disabled={busy} onClick={() => void act("cancel")}>
              {summary.billing_status === "created" ? "Cancel checkout" : "Cancel plan renewal"}
            </button>
          )}
        </div>
      )}
      {part !== "actions" &&
      ((summary.status === "active" && !summary.trial) || seats.length > 0) ? (
        <section className="crm-billing-seats">
          <div>
            <h3>Additional users</h3>
            <p className="crm-muted">
              {rupees(EXTRA_SEAT_PAISE)} per user per month, billed separately
              with no duration discount.{" "}
              {summary.status === "active"
                ? "Removing a team member doesn’t cancel a paid seat; cancel the seat’s renewal here."
                : "You can add users once your plan is active."}
            </p>
          </div>
          {summary.status === "active" && !summary.trial && (
            <div className="crm-seat-add">
              <label>
                Seats to add
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </label>
              <button
                className="crm-primary"
                disabled={
                  busy ||
                  !Number.isInteger(quantity) ||
                  quantity < 1 ||
                  quantity > 100
                }
                onClick={() => void act("subscribe-seats")}
              >
                Add {quantity} {quantity === 1 ? "seat" : "seats"} ·{" "}
                {rupees(quantity * EXTRA_SEAT_PAISE)}/month
              </button>
            </div>
          )}
          {seats.length > 0 && (
            <ul className="crm-seat-list">
              {seats.map((seat) => (
                <li key={seat.id}>
                  <div>
                    <strong>
                      {seat.quantity} additional {seat.quantity === 1 ? "user" : "users"}
                      {seat.unit_paise ? ` · ${rupees(seat.quantity * seat.unit_paise)}/month` : ""}
                    </strong>
                    <span className={seat.status === "active" ? "crm-badge won" : "crm-badge"}>
                      {seatStatus[seat.status] ?? seat.status}
                    </span>
                  </div>
                  <div className="crm-seat-list-actions">
                    {seat.status === "created" && summary.status === "active" && (
                      <button className="crm-primary" disabled={busy} onClick={() => void act("resume", seat.id)}>
                        Complete payment
                      </button>
                    )}
                    {!["cancelled", "completed", "expired"].includes(seat.status) && (
                      <button disabled={busy} onClick={() => void act("cancel", seat.id)}>
                        {seat.status === "created" ? "Cancel checkout" : "Cancel renewal"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
