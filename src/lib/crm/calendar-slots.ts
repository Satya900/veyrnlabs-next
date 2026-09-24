export type Busy = { start: string; end: string };

export function istDayBounds(dateStr: string) {
  return {
    start: new Date(`${dateStr}T09:00:00+05:30`),
    end: new Date(`${dateStr}T18:00:00+05:30`),
  };
}

export function slotGrid(start: Date, end: Date, minutes = 30) {
  const slots: Date[] = [];
  for (
    let t = start.getTime();
    t + minutes * 60_000 <= end.getTime();
    t += minutes * 60_000
  )
    slots.push(new Date(t));
  return slots;
}

export function overlaps(slotStart: Date, slotEnd: Date, busy: Busy[]) {
  return busy.some(
    (b) => slotStart < new Date(b.end) && slotEnd > new Date(b.start),
  );
}

/** Resolves an IST "YYYY-MM-DD" + "HH:MM" pair (as extracted from a conversation) to a UTC
 * instant, but only when it lands exactly on a bookable 30-minute business-hours slot and is
 * strictly in the future. Returns null for anything else (malformed, outside business hours,
 * off the 30-minute grid, or already past) so callers treat an unclear request as unresolved
 * rather than silently rounding or guessing a time nobody actually asked for. */
export function resolveIstSlot(
  date: string,
  time: string,
  now: Date = new Date(),
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    return null;
  const start = new Date(`${date}T${time}:00+05:30`);
  if (Number.isNaN(start.getTime()) || start.getTime() <= now.getTime())
    return null;
  const { start: dayStart, end: dayEnd } = istDayBounds(date);
  const onGrid = slotGrid(dayStart, dayEnd).some(
    (slot) => slot.getTime() === start.getTime(),
  );
  return onGrid ? start : null;
}
