/**
 * Authoritative operating timezone helpers for The AI School (Asia/Kolkata / IST).
 *
 * Never use `new Date().toISOString().slice(0, 10)` for calendar work dates:
 * between 00:00 and 05:30 IST, UTC is still on the previous calendar day.
 */
export const ORG_TIMEZONE = "Asia/Kolkata";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORG_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ORG_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Returns `YYYY-MM-DD` in `Asia/Kolkata` for the given instant (defaults to `new Date()`). */
export function todayIso(now: Date = new Date()): string {
  return dateFormatter.format(now);
}

/** Returns `YYYY-MM-DD` in `Asia/Kolkata` for `days` days ago. */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return todayIso(new Date(now.getTime() - days * 86_400_000));
}

/** Returns the first day of the current month (`YYYY-MM-01`) in `Asia/Kolkata`. */
export function startOfMonthIso(now: Date = new Date()): string {
  return `${todayIso(now).slice(0, 7)}-01`;
}

/** Returns `{ hours, minutes }` in `Asia/Kolkata` for the given instant. */
export function istHoursMinutes(now: Date = new Date()): { hours: number; minutes: number } {
  const parts = timePartsFormatter.formatToParts(now);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  return {
    hours: Number(hourStr) % 24,
    minutes: Number(minuteStr),
  };
}

