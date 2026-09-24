"use client";
import { useState } from "react";
import { useWorkspaceContext } from "./context";
import { istDayBounds, overlaps, slotGrid, type Busy } from "@/lib/crm/calendar-slots";

export function ScheduleVisit({ leadId }: { leadId: string }) {
  const { reload, now } = useWorkspaceContext();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<Busy[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState("");
  const [error, setError] = useState("");
  const [booked, setBooked] = useState<{ htmlLink?: string } | null>(null);

  async function loadSlots() {
    setLoading(true);
    setError("");
    setBusy(null);
    try {
      const { start, end } = istDayBounds(date);
      const params = new URLSearchParams({
        leadId,
        from: start.toISOString(),
        to: end.toISOString(),
      });
      const res = await fetch(`/api/crm/calendar/slots?${params}`, {
        cache: "no-store",
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setBusy(result.busy);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load availability.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function book(slotStart: Date, slotEnd: Date) {
    setBooking(slotStart.toISOString());
    setError("");
    try {
      const res = await fetch("/api/crm/calendar/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          startIso: slotStart.toISOString(),
          endIso: slotEnd.toISOString(),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setBooked(result);
      setBusy(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book this visit.");
    } finally {
      setBooking("");
    }
  }

  const { start, end } = istDayBounds(date);
  const slots = slotGrid(start, end);

  return (
    <div className="crm-schedule-visit">
      <h3>Schedule a site visit</h3>
      <div className="crm-schedule-controls">
        <input
          type="date"
          aria-label="Visit date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setBusy(null);
            setBooked(null);
          }}
        />
        <button type="button" disabled={loading} onClick={() => void loadSlots()}>
          {loading ? "Checking availability…" : "Check availability"}
        </button>
      </div>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {booked && (
        <p role="status" className="crm-muted">
          Booked.{" "}
          {booked.htmlLink && (
            <a href={booked.htmlLink} target="_blank" rel="noreferrer">
              View in Google Calendar
            </a>
          )}
        </p>
      )}
      {busy !== null && (
        <div className="crm-slot-grid">
          {slots.map((slotStart) => {
            const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
            const key = slotStart.toISOString();
            const taken = overlaps(slotStart, slotEnd, busy);
            // The server rejects any start time already in the past (crm/calendar/book);
            // without this check a slot grid viewed partway through the day would show
            // already-passed hours as bookable, and clicking one would just fail.
            const past = slotStart.getTime() <= now;
            return (
              <button
                key={key}
                type="button"
                disabled={taken || past || !!booking}
                onClick={() => void book(slotStart, slotEnd)}
              >
                {booking === key
                  ? "Booking…"
                  : slotStart.toLocaleTimeString("en-IN", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "Asia/Kolkata",
                    })}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
