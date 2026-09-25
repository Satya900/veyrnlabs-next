"use client";
import { useEffect, useState } from "react";
import { useWorkspaceContext } from "./context";
import { istDayBounds, overlaps, slotGrid, type Busy } from "@/lib/crm/calendar-slots";

type Visit = { booking_id: string; starts_at: string; ends_at: string; status: string } | null;

function formatVisit(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`;
}

export function ScheduleVisit({ leadId }: { leadId: string }) {
  const { reload, now } = useWorkspaceContext();
  const [visit, setVisit] = useState<Visit>(null);
  const [visitLoaded, setVisitLoaded] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<Busy[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState("");
  const [error, setError] = useState("");
  const [booked, setBooked] = useState<{ htmlLink?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/crm/calendar/visit?leadId=${leadId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (!cancelled) setVisit(result.visit ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setVisitLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function cancelVisit() {
    if (!visit) return;
    setCancelling(true);
    setError("");
    try {
      const res = await fetch("/api/crm/calendar/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: visit.booking_id }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setVisit(null);
      setBooked(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel this visit.");
    } finally {
      setCancelling(false);
    }
  }

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
      setRescheduling(false);
      setVisit({
        booking_id: "",
        starts_at: slotStart.toISOString(),
        ends_at: slotEnd.toISOString(),
        status: "booked",
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book this visit.");
    } finally {
      setBooking("");
    }
  }

  const { start, end } = istDayBounds(date);
  const slots = slotGrid(start, end);

  if (!visitLoaded)
    return (
      <div className="crm-schedule-visit">
        <h3>Schedule a site visit</h3>
      </div>
    );

  if (visit && !rescheduling)
    return (
      <div className="crm-schedule-visit">
        <h3>Schedule a site visit</h3>
        <p role="status" className="crm-muted">
          Booked for {formatVisit(visit.starts_at)}.
        </p>
        {error && (
          <p role="alert" className="crm-error">
            {error}
          </p>
        )}
        <div className="crm-schedule-controls">
          <button
            type="button"
            disabled={cancelling}
            onClick={() => setRescheduling(true)}
          >
            Change time
          </button>
          <button type="button" disabled={cancelling} onClick={() => void cancelVisit()}>
            {cancelling ? "Cancelling…" : "Cancel visit"}
          </button>
        </div>
      </div>
    );

  return (
    <div className="crm-schedule-visit">
      <h3>Schedule a site visit</h3>
      {visit && rescheduling && (
        <p className="crm-muted">
          Currently booked for {formatVisit(visit.starts_at)}. Booking a new time below
          cancels this one.
        </p>
      )}
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
        {visit && rescheduling && (
          <button type="button" onClick={() => setRescheduling(false)}>
            Keep current time
          </button>
        )}
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
                onClick={async () => {
                  if (visit && rescheduling) {
                    setBooking(slotStart.toISOString());
                    setError("");
                    try {
                      const res = await fetch("/api/crm/calendar/cancel", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bookingId: visit.booking_id }),
                      });
                      const result = await res.json();
                      if (!res.ok) throw new Error(result.error);
                      // The old slot is confirmed released before booking the new one, so a
                      // failure past this point correctly shows "not booked" rather than a
                      // stale claim that the cancelled time is still held.
                      setVisit(null);
                    } catch (err) {
                      setBooking("");
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Could not release the current time.",
                      );
                      return;
                    }
                  }
                  await book(slotStart, slotEnd);
                }}
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
