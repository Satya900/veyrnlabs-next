"use client";
import { useState } from "react";
import type { UsageSummary } from "@/lib/crm/plans";
import { loadRazorpayScript } from "./Billing";

export function BillingManage({
  summary,
  reload,
}: {
  summary: UsageSummary;
  reload: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: string, subscriptionId?: string) {
    if (
      action === "cancel" &&
      !window.confirm(
        "Cancel this subscription’s renewal? Already-paid access continues until its end date.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/crm/billing", {
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
  return (
    <div className="crm-ai-settings">
      {summary.billing_status === "created" && (
        <button disabled={busy} onClick={() => void act("resume")}>
          Resume checkout
        </button>
      )}
      {summary.billing_status &&
        !["cancelled", "completed", "expired"].includes(
          summary.billing_status,
        ) && (
          <button disabled={busy} onClick={() => void act("cancel")}>
            Cancel plan renewal
          </button>
        )}
      {summary.status === "active" && !summary.trial && (
        <>
          <h3>Additional users</h3>
          <p>
            ₹500 per user per month, billed separately. No duration discount.
            Seats activate after payment; AI and message allowances stay the
            same.
          </p>
          <label>
            Seats to add{" "}
            <input
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <button
            disabled={
              busy ||
              !Number.isInteger(quantity) ||
              quantity < 1 ||
              quantity > 100
            }
            onClick={() => void act("subscribe-seats")}
          >
            Add {quantity} seats · ₹{(quantity * 500).toLocaleString("en-IN")}
            /month
          </button>
        </>
      )}
      {summary.seat_subscriptions?.map((seat) => (
        <div key={seat.id}>
          <p>
            {seat.quantity} additional users · ₹
            {(seat.quantity * 500).toLocaleString("en-IN")}/month ·{" "}
            {seat.status}
          </p>
          {seat.status === "created" && (
            <button disabled={busy} onClick={() => void act("resume", seat.id)}>
              Complete seat payment
            </button>
          )}
          <button disabled={busy} onClick={() => void act("cancel", seat.id)}>
            Cancel these seats’ renewal
          </button>
        </div>
      ))}
      <p>
        Removing a team member does not cancel a paid seat. Cancel the seat
        subscription to stop its renewal.
      </p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
