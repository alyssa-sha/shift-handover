import { describe, expect, it } from "vitest";

import {
  addDays,
  buildWeek,
  compareSlots,
  deriveSlotStatus,
  findNextShifts,
  findPreviousShift,
  nextShiftStart,
  type ShiftSlot,
  slotStatusLabel,
  startOfWeek,
  weekWindow,
} from "@/lib/shifts";

/**
 * Shifts are built from local wall-clock times on purpose: the calendar buckets
 * by local day, so a test written in UTC would pass or fail depending on the
 * machine's timezone.
 */
function slot(
  id: string,
  location: string,
  name: string,
  start: [number, number, number, number],
  durationHours = 8,
): ShiftSlot {
  const [year, month, day, hour] = start;
  const startsAt = new Date(year, month - 1, day, hour, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + durationHours * 3600000);
  return {
    id,
    location,
    name,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  };
}

// 2026-09-09 is a Wednesday.
const morning = slot("m", "Terminal 2", "Morning", [2026, 9, 9, 6]);
const evening = slot("e", "Terminal 2", "Evening", [2026, 9, 9, 14]);
const night = slot("n", "Terminal 2", "Night", [2026, 9, 9, 22]);
const nextMorning = slot("m2", "Terminal 2", "Morning", [2026, 9, 10, 6]);
const otherLocationEvening = slot("w", "Ward B", "Evening", [2026, 9, 9, 14]);

const week = [morning, evening, night, nextMorning, otherLocationEvening];

describe("startOfWeek", () => {
  it("returns the Monday of the week containing the date", () => {
    const monday = startOfWeek(new Date(2026, 8, 9, 22, 30));
    expect(monday.getFullYear()).toBe(2026);
    expect(monday.getMonth()).toBe(8);
    expect(monday.getDate()).toBe(7);
    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
  });

  it("treats Sunday as the last day of the week, not the first", () => {
    // Sunday 2026-09-13 belongs to the week beginning Monday 2026-09-07.
    const monday = startOfWeek(new Date(2026, 8, 13, 12, 0));
    expect(monday.getDate()).toBe(7);
  });

  it("is idempotent on a Monday at midnight", () => {
    const monday = startOfWeek(new Date(2026, 8, 7, 0, 0));
    expect(startOfWeek(monday).getTime()).toBe(monday.getTime());
  });
});

describe("weekWindow", () => {
  it("pads a day either side so the preceding shift is fetchable", () => {
    // FR-4.4: a Monday morning slot hands over from Sunday night, which is in
    // the previous week and would otherwise not be in the result set.
    const monday = startOfWeek(new Date(2026, 8, 9));
    const { from, to } = weekWindow(monday);
    expect(from.getTime()).toBe(addDays(monday, -1).getTime());
    expect(to.getTime()).toBe(addDays(monday, 8).getTime());
  });
});

describe("buildWeek", () => {
  it("produces seven day buckets starting on the Monday", () => {
    const monday = startOfWeek(new Date(2026, 8, 9));
    const days = buildWeek(week, monday);
    expect(days).toHaveLength(7);
    expect(days[0].date.getDate()).toBe(7);
    expect(days[6].date.getDate()).toBe(13);
  });

  it("buckets each shift on its local start day, sorted by start time", () => {
    const monday = startOfWeek(new Date(2026, 8, 9));
    const days = buildWeek(week, monday);

    // Wednesday is index 2.
    expect(days[2].shifts.map((s) => s.id)).toEqual(["m", "e", "w", "n"]);
    expect(days[3].shifts.map((s) => s.id)).toEqual(["m2"]);
    expect(days[0].shifts).toHaveLength(0);
  });

  it("drops shifts outside the week, including the padded query window", () => {
    const monday = startOfWeek(new Date(2026, 8, 9));
    const lastSunday = slot("prev", "Terminal 2", "Night", [2026, 9, 6, 22]);
    const nextMonday = slot("after", "Terminal 2", "Morning", [2026, 9, 14, 6]);

    const days = buildWeek([...week, lastSunday, nextMonday], monday);
    const ids = days.flatMap((day) => day.shifts.map((s) => s.id));
    expect(ids).not.toContain("prev");
    expect(ids).not.toContain("after");
    expect(ids).toHaveLength(5);
  });

  it("ignores an unparseable timestamp rather than throwing", () => {
    const monday = startOfWeek(new Date(2026, 8, 9));
    const broken: ShiftSlot = {
      id: "x",
      location: "Terminal 2",
      name: "Broken",
      starts_at: "not a date",
      ends_at: "not a date",
    };
    const days = buildWeek([broken, morning], monday);
    expect(days.flatMap((d) => d.shifts.map((s) => s.id))).toEqual(["m"]);
  });
});

describe("compareSlots", () => {
  it("orders by start time first, then location", () => {
    expect(compareSlots(morning, evening)).toBeLessThan(0);
    expect(compareSlots(night, evening)).toBeGreaterThan(0);
    // Same start time, different location.
    expect(compareSlots(evening, otherLocationEvening)).toBeLessThan(0);
  });
});

describe("deriveSlotStatus", () => {
  it("reports no handover when the viewer may read and none exists", () => {
    expect(deriveSlotStatus({ canReadHandover: true })).toBe("none");
    expect(
      deriveSlotStatus({ canReadHandover: true, handoverStatus: null }),
    ).toBe("none");
  });

  it("passes the handover status through for a permitted viewer", () => {
    expect(
      deriveSlotStatus({ canReadHandover: true, handoverStatus: "submitted" }),
    ).toBe("submitted");
    expect(
      deriveSlotStatus({ canReadHandover: true, handoverStatus: "approved" }),
    ).toBe("approved");
  });

  it("does not claim 'no handover' for a slot the viewer cannot read", () => {
    // An operator seeing somebody else's slot gets zero rows from RLS. Reading
    // that as "no handover yet" would be a false statement about the shift.
    expect(deriveSlotStatus({ canReadHandover: false })).toBe("unknown");
    expect(
      deriveSlotStatus({ canReadHandover: false, handoverStatus: "approved" }),
    ).toBe("unknown");
  });

  it("labels an approved handover as published (decision D2)", () => {
    expect(slotStatusLabel("approved")).toBe("Published");
    expect(slotStatusLabel("changes_requested")).toBe("Changes requested");
    expect(slotStatusLabel("none")).toBe("No handover");
    expect(slotStatusLabel("unknown")).toBe("Not visible");
  });
});

describe("nextShiftStart / findNextShifts", () => {
  it("finds the earliest shift starting at or after this one ends", () => {
    const start = nextShiftStart(week, morning);
    expect(start).toBe(new Date(evening.starts_at).getTime());
    expect(findNextShifts(week, morning).map((s) => s.id)).toEqual(["e"]);
  });

  it("ignores other locations", () => {
    expect(findNextShifts(week, evening).map((s) => s.id)).toEqual(["n"]);
  });

  it("returns every tied shift, the way the SQL helper does", () => {
    const twin = slot("e-twin", "Terminal 2", "Evening", [2026, 9, 9, 14]);
    expect(
      findNextShifts([...week, twin], morning)
        .map((s) => s.id)
        .sort(),
    ).toEqual(["e", "e-twin"]);
  });

  it("returns nothing when the shift is the last one at its location", () => {
    expect(nextShiftStart(week, nextMorning)).toBeNull();
    expect(findNextShifts(week, nextMorning)).toEqual([]);
  });
});

describe("findPreviousShift", () => {
  it("resolves the slot immediately before this one at the same location", () => {
    expect(findPreviousShift(week, evening)?.id).toBe("m");
    expect(findPreviousShift(week, night)?.id).toBe("e");
    // Crosses midnight: the Thursday morning slot follows Wednesday night.
    expect(findPreviousShift(week, nextMorning)?.id).toBe("n");
  });

  it("returns null when nothing precedes the shift", () => {
    expect(findPreviousShift(week, morning)).toBeNull();
  });

  it("never crosses a location boundary", () => {
    // Ward B has a single slot in this set, so it has no predecessor even
    // though Terminal 2 shifts end before it starts.
    expect(findPreviousShift(week, otherLocationEvening)).toBeNull();
  });

  it("picks the latest starter when several slots qualify as predecessor", () => {
    // A cover slot running 12:00-20:00 also hands over to the 22:00 night
    // shift, so both it and the evening slot satisfy the RLS helper. The one
    // that started last is the immediate predecessor an operator means.
    const overlap = slot("overlap", "Terminal 2", "Handover cover", [
      2026, 9, 9, 12,
    ]);
    const all = [...week, overlap];
    expect(nextShiftStart(all, overlap)).toBe(
      new Date(night.starts_at).getTime(),
    );
    expect(findPreviousShift(all, night)?.id).toBe("e");
  });

  it("skips a candidate whose own next shift is somebody else", () => {
    // The morning slot ends at 14:00 where the evening slot starts, so its next
    // shift is the evening one. It is never the night slot's predecessor, even
    // though it ends before the night slot starts - and RLS agrees, so a link
    // built on "latest shift that ended earlier" would return zero rows.
    expect(nextShiftStart(week, morning)).toBe(
      new Date(evening.starts_at).getTime(),
    );
    expect(findPreviousShift(week, night)?.id).toBe("e");
  });
});
