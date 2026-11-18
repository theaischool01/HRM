/** Fixed hourly slots for the working day (10:00–18:00 Asia/Kolkata IST).
 *
 * Breaks are logged separately as break_logs (e.g. Lunch 13:30–14:30 and Short
 * Break 16:45–17:00), so no slot is removed from DAY_SLOTS — breaks overlap the
 * slot they occur in and coverage maths accounts for them.
 *
 * Legacy entries logged during 09:00–10:00 remain viewable via `LEGACY_SLOT_09_10`
 * so historical records are never lost or corrupted.
 */
export type DaySlot = {
  /** Stable key, e.g. "10-11" or legacy "09-10". */
  key: string;
  startHour: number;
  endHour: number;
  label: string;
  isLegacy?: boolean;
};

export const START_HOUR = 10;
export const END_HOUR = 18;
export const IST_OFFSET_MS = (5 * 60 + 30) * 60_000; // +05:30 IST

const label12 = (hour: number) => {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00`;
};

export const DAY_SLOTS: DaySlot[] = Array.from(
  { length: END_HOUR - START_HOUR },
  (_, index): DaySlot => {
    const startHour = START_HOUR + index;
    const endHour = startHour + 1;
    return {
      key: `${String(startHour).padStart(2, "0")}-${String(endHour).padStart(2, "0")}`,
      startHour,
      endHour,
      label: `${label12(startHour)}–${label12(endHour)}`,
    };
  },
);

/** Preserved slot for historical 09:00–10:00 IST entries logged before the shift change. */
export const LEGACY_SLOT_09_10: DaySlot = {
  key: "09-10",
  startHour: 9,
  endHour: 10,
  label: "9:00–10:00",
  isLegacy: true,
};

/**
 * Returns the visible slots for a day.
 * If the day contains an entry logged for the historical 09:00–10:00 slot,
 * that slot is prepended so historical data remains viewable and accessible.
 * For new days, only the official 8 slots (10:00–18:00) are displayed.
 */
export function getVisibleDaySlots(entries?: { started_at: string; ended_at: string }[]): DaySlot[] {
  if (entries && entries.some((e) => slotKeyOf(e.started_at, e.ended_at) === "09-10")) {
    return [LEGACY_SLOT_09_10, ...DAY_SLOTS];
  }
  return DAY_SLOTS;
}

/**
 * Deterministic UTC boundaries for an Asia/Kolkata (IST) wall-clock slot.
 *
 * For example on 2026-11-18:
 * - 10:00–11:00 IST produces 2026-11-18T04:30:00.000Z to 2026-11-18T05:30:00.000Z
 * - 17:00–18:00 IST produces 2026-11-18T11:30:00.000Z to 2026-11-18T12:30:00.000Z
 *
 * Evaluates identically regardless of the client or server host time zone.
 */
export function slotRange(workDate: string, slot: DaySlot): { start: Date; end: Date } {
  const startStr = `${workDate}T${String(slot.startHour).padStart(2, "0")}:00:00+05:30`;
  const endStr = `${workDate}T${String(slot.endHour).padStart(2, "0")}:00:00+05:30`;
  const start = new Date(startStr);
  const end = new Date(endStr);
  return { start, end };
}

/**
 * Matches an existing entry back to its slot by Asia/Kolkata (IST) wall-clock start hour.
 * Evaluates in UTC offset +05:30 so host machine time zone differences never cause skew.
 */
export function slotKeyOf(startedAt: string, endedAt: string): string | null {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return null;
  if (endMs - startMs !== 3_600_000) return null;

  // Convert to Asia/Kolkata time (+05:30)
  const istDate = new Date(startMs + IST_OFFSET_MS);
  if (istDate.getUTCMinutes() !== 0 || istDate.getUTCSeconds() !== 0) return null;

  const startHour = istDate.getUTCHours();
  const endHour = startHour + 1;
  const key = `${String(startHour).padStart(2, "0")}-${String(endHour).padStart(2, "0")}`;

  if (DAY_SLOTS.some((s) => s.key === key) || key === "09-10") {
    return key;
  }
  return null;
}
