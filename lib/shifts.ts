/**
 * Pure shift-calendar logic (FR-4).
 *
 * No Supabase, no React, no Next imports: everything here is a plain function
 * over plain data, so week bucketing, slot status and previous/next shift
 * resolution can be unit-tested without a database. The pages fetch the rows
 * and hand them in.
 */

import type { HandoverStatus, Shift } from "@/lib/types/database";

/** The only shift columns the calendar logic needs. */
export type ShiftSlot = Pick<
  Shift,
  "id" | "location" | "name" | "starts_at" | "ends_at"
>;

/** Milliseconds since the epoch for a timestamptz string. */
function ms(timestamp: string): number {
  return new Date(timestamp).getTime();
}

// -----------------------------------------------------------------------------
// Week bucketing (FR-4.2)
// -----------------------------------------------------------------------------

export const DAYS_IN_WEEK = 7;

const MS_PER_DAY = 86400000;

/** Monday 00:00 local time for the week containing `reference`. */
export function startOfWeek(reference: Date): Date {
  const start = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
  );
  // getDay(): 0 = Sunday. A Monday-based week puts Sunday six days in.
  const offset = (start.getDay() + 6) % DAYS_IN_WEEK;
  start.setDate(start.getDate() - offset);
  return start;
}

/** `date` moved by whole days, staying at local midnight across DST changes. */
export function addDays(date: Date, days: number): Date {
  const moved = new Date(date);
  moved.setDate(moved.getDate() + days);
  return moved;
}

/**
 * The window to query shifts for.
 *
 * Padded by a day either side of the displayed week so FR-4.4 can resolve the
 * shift preceding a Monday-morning slot, which sits in the previous week.
 */
export function weekWindow(
  weekStart: Date,
  padDays = 1,
): { from: Date; to: Date } {
  return {
    from: addDays(weekStart, -padDays),
    to: addDays(weekStart, DAYS_IN_WEEK + padDays),
  };
}

export type WeekDay = {
  /** Local midnight for this column. */
  date: Date;
  shifts: ShiftSlot[];
};

/** Ascending by start time, then location, then name: a stable slot order. */
export function compareSlots(a: ShiftSlot, b: ShiftSlot): number {
  return (
    ms(a.starts_at) - ms(b.starts_at) ||
    a.location.localeCompare(b.location) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Seven day buckets from `weekStart`, each holding the shifts that begin on
 * that local day. Shifts outside the week are dropped, so the padded query
 * window above never leaks into the view.
 */
export function buildWeek(shifts: ShiftSlot[], weekStart: Date): WeekDay[] {
  const days: WeekDay[] = [];
  for (let index = 0; index < DAYS_IN_WEEK; index += 1) {
    days.push({ date: addDays(weekStart, index), shifts: [] });
  }

  const start = weekStart.getTime();
  const weekEnd = addDays(weekStart, DAYS_IN_WEEK).getTime();

  for (const shift of shifts) {
    const startsAt = ms(shift.starts_at);
    if (Number.isNaN(startsAt) || startsAt < start || startsAt >= weekEnd) {
      continue;
    }
    const localMidnight = new Date(startsAt).setHours(0, 0, 0, 0);
    const dayIndex = Math.round((localMidnight - start) / MS_PER_DAY);
    // A DST change moves a boundary by an hour; clamp rather than drop a slot.
    const bucket = days[Math.min(Math.max(dayIndex, 0), DAYS_IN_WEEK - 1)];
    bucket.shifts.push(shift);
  }

  for (const day of days) day.shifts.sort(compareSlots);
  return days;
}

// -----------------------------------------------------------------------------
// Slot status (FR-4.3)
// -----------------------------------------------------------------------------

/**
 * What the calendar shows on a slot.
 *
 * `none` means "readable, and there is no handover yet". `unknown` means the
 * viewer may not read this shift's handover at all - an operator looking at
 * somebody else's slot - so claiming "no handover" would be a false negative
 * (FR-2.2 wants zero rows, not an error, and not a wrong answer either).
 */
export type SlotStatus = "unknown" | "none" | HandoverStatus;

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  unknown: "Not visible",
  none: "No handover",
  draft: "Draft",
  submitted: "Submitted",
  changes_requested: "Changes requested",
  // Approval is publication (decision D2); the calendar speaks the operator's
  // language rather than the database's.
  approved: "Published",
};

export function slotStatusLabel(status: SlotStatus): string {
  return SLOT_STATUS_LABEL[status];
}

export type SlotStatusInput = {
  /** True when RLS lets this viewer read the shift's handover row. */
  canReadHandover: boolean;
  handoverStatus?: HandoverStatus | null;
};

export function deriveSlotStatus({
  canReadHandover,
  handoverStatus,
}: SlotStatusInput): SlotStatus {
  if (!canReadHandover) return "unknown";
  return handoverStatus ?? "none";
}

// -----------------------------------------------------------------------------
// Previous / next shift resolution (FR-4.4, FR-8.1)
// -----------------------------------------------------------------------------

/**
 * The start time of the shift that follows `shift` at the same location: the
 * earliest start at or after this shift's end.
 *
 * This mirrors `is_incoming_for_shift()` and the notification trigger in
 * 0001_init.sql exactly. If the two ever disagree, the calendar offers a link
 * to a handover RLS will not return.
 */
export function nextShiftStart(
  all: ShiftSlot[],
  shift: ShiftSlot,
): number | null {
  const endsAt = ms(shift.ends_at);
  let earliest: number | null = null;

  for (const candidate of all) {
    if (candidate.id === shift.id) continue;
    if (candidate.location !== shift.location) continue;
    const startsAt = ms(candidate.starts_at);
    if (Number.isNaN(startsAt) || startsAt < endsAt) continue;
    if (earliest === null || startsAt < earliest) earliest = startsAt;
  }

  return earliest;
}

/** Every shift that qualifies as the next one - ties included, as SQL does. */
export function findNextShifts(all: ShiftSlot[], shift: ShiftSlot): ShiftSlot[] {
  const start = nextShiftStart(all, shift);
  if (start === null) return [];
  return all
    .filter(
      (candidate) =>
        candidate.id !== shift.id &&
        candidate.location === shift.location &&
        ms(candidate.starts_at) === start,
    )
    .sort(compareSlots);
}

/**
 * The shift immediately preceding `shift` at the same location, defined as the
 * inverse of `findNextShifts`: the candidate whose own next shift is this one.
 *
 * Defining it that way rather than as "the latest earlier shift" is deliberate.
 * RLS grants the incoming operator a read only when
 * `is_incoming_for_shift(previous)` is true, and that helper uses the forward
 * definition; a previous shift chosen by any other rule could return zero rows.
 */
export function findPreviousShift(
  all: ShiftSlot[],
  shift: ShiftSlot,
): ShiftSlot | null {
  const startsAt = ms(shift.starts_at);
  const candidates = all.filter((candidate) => {
    if (candidate.id === shift.id) return false;
    if (candidate.location !== shift.location) return false;
    if (ms(candidate.ends_at) > startsAt) return false;
    return nextShiftStart(all, candidate) === startsAt;
  });

  if (candidates.length === 0) return null;
  // Latest first: the immediately preceding slot, not an older overlapping one.
  return candidates.sort(compareSlots)[candidates.length - 1];
}

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

/** e.g. "Wed 9 Sep". */
export function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

/** e.g. "22:00". */
export function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

/** e.g. "9 Sep 2026, 22:00". */
export function formatDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

/** The slot's clock window, e.g. "22:00 - 06:00". */
export function formatSlotRange(shift: ShiftSlot): string {
  return `${formatTime(shift.starts_at)} - ${formatTime(shift.ends_at)}`;
}
