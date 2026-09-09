import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SlotStatusBadge } from "@/components/SlotStatusBadge";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import {
  type ShiftSlot,
  type SlotStatus,
  addDays,
  buildWeek,
  deriveSlotStatus,
  findPreviousShift,
  formatDayLabel,
  formatSlotRange,
  startOfWeek,
  weekWindow,
} from "@/lib/shifts";
import { createClient } from "@/lib/supabase/server";
import type { HandoverStatus } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Calendar · Shift Handover",
};

/** Demo scale (§9.4): one week of slots at two locations is well inside this. */
const SHIFT_QUERY_LIMIT = 500;

type SlotView = {
  shift: ShiftSlot;
  isMine: boolean;
  status: SlotStatus;
  crew: string[];
  /** The preceding shift, when its handover is published and readable. */
  previousPublished: ShiftSlot | null;
  canOpen: boolean;
};

export default async function CalendarPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(SIGN_IN_PATH);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  const isSupervisor = profile?.role === "supervisor";

  const weekStart = startOfWeek(new Date());
  const { from, to } = weekWindow(weekStart);

  // A day of padding either side: the shift preceding a Monday morning slot
  // sits in the previous week, and FR-4.4 has to be able to resolve it.
  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("id, location, name, starts_at, ends_at")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at", { ascending: true })
    .limit(SHIFT_QUERY_LIMIT);

  const shifts: ShiftSlot[] = shiftRows ?? [];
  const shiftIds = shifts.map((shift) => shift.id);

  // Assignments and handovers are both filtered by RLS: an operator gets their
  // own shifts' handovers plus any published handover they are the incoming
  // shift for, and nothing else. Everyone may read assignments and display
  // names, which is what lets a slot show who is on it.
  const [assignmentResult, handoverResult] = await Promise.all([
    shiftIds.length
      ? supabase
          .from("shift_assignments")
          .select("shift_id, user_id")
          .in("shift_id", shiftIds)
      : Promise.resolve({ data: [] }),
    shiftIds.length
      ? supabase.from("handovers").select("shift_id, status").in("shift_id", shiftIds)
      : Promise.resolve({ data: [] }),
  ]);

  const assignments = assignmentResult.data ?? [];
  const handovers = handoverResult.data ?? [];

  const crewIds = [...new Set(assignments.map((row) => row.user_id))];
  const { data: crewProfiles } = crewIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", crewIds)
    : { data: [] };

  const nameById = new Map(
    (crewProfiles ?? []).map((row) => [row.id, row.full_name]),
  );

  const crewByShift = new Map<string, string[]>();
  const myShiftIds = new Set<string>();
  for (const row of assignments) {
    const names = crewByShift.get(row.shift_id) ?? [];
    names.push(nameById.get(row.user_id) ?? "Unknown user");
    crewByShift.set(row.shift_id, names);
    if (row.user_id === user.id) myShiftIds.add(row.shift_id);
  }

  const handoverStatusByShift = new Map<string, HandoverStatus>(
    handovers.map((row) => [row.shift_id, row.status]),
  );

  const week = buildWeek(shifts, weekStart);

  const toSlotView = (shift: ShiftSlot): SlotView => {
    const isMine = myShiftIds.has(shift.id);
    const handoverStatus = handoverStatusByShift.get(shift.id) ?? null;

    // A handover row that came back is by definition readable. Otherwise only a
    // supervisor or an assigned operator can be sure there is none, so anybody
    // else sees "not visible" rather than a wrong "no handover".
    const status = deriveSlotStatus({
      canReadHandover: isSupervisor || isMine || handoverStatus !== null,
      handoverStatus,
    });

    // FR-4.4: from my own slot, one click to the previous shift's published
    // handover. Only offered when it is approved, which is also the only case
    // RLS will return it for an incoming operator.
    const previous = isMine ? findPreviousShift(shifts, shift) : null;
    const previousPublished =
      previous && handoverStatusByShift.get(previous.id) === "approved"
        ? previous
        : null;

    return {
      shift,
      isMine,
      status,
      crew: crewByShift.get(shift.id) ?? [],
      previousPublished,
      canOpen: isSupervisor || isMine,
    };
  };

  const weekEndLabel = formatDayLabel(addDays(weekStart, 6));

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Shift calendar</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {formatDayLabel(weekStart)} – {weekEndLabel} ·{" "}
            {isSupervisor
              ? "All slots, every location."
              : "Your slots are highlighted."}
          </p>
        </div>

        {isSupervisor ? (
          <Link
            href="/review"
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Review queue
          </Link>
        ) : null}
      </div>

      {shifts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          No shift slots exist for this week. Run{" "}
          <code className="font-mono">supabase/seed.sql</code> in the Supabase SQL
          editor to create them.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {week.map((day) => (
            <div key={day.date.toISOString()} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
                {formatDayLabel(day.date)}
              </h2>

              {day.shifts.length === 0 ? (
                <p className="rounded-md border border-dashed border-black/10 px-3 py-4 text-xs text-black/40 dark:border-white/15 dark:text-white/40">
                  No slots
                </p>
              ) : (
                day.shifts.map((shift) => (
                  <SlotCard key={shift.id} slot={toSlotView(shift)} />
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SlotCard({ slot }: { slot: SlotView }) {
  const { shift, isMine, status, crew, previousPublished, canOpen } = slot;

  const frame = isMine
    ? "border-foreground/40 bg-foreground/[0.04] ring-1 ring-foreground/20"
    : "border-black/10 dark:border-white/15";

  return (
    <div className={`space-y-2 rounded-lg border p-3 ${frame}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{shift.name}</p>
          <p className="truncate text-xs text-black/60 dark:text-white/60">
            {shift.location}
          </p>
        </div>
        {isMine ? (
          <span className="shrink-0 rounded-full border border-foreground/30 px-2 py-0.5 text-[10px] uppercase tracking-wide">
            Yours
          </span>
        ) : null}
      </div>

      <p className="font-mono text-xs text-black/70 dark:text-white/70">
        {formatSlotRange(shift)}
      </p>

      <SlotStatusBadge status={status} />

      {crew.length > 0 ? (
        <p className="text-xs text-black/55 dark:text-white/55">
          {crew.join(", ")}
        </p>
      ) : (
        <p className="text-xs text-black/40 dark:text-white/40">Unrostered</p>
      )}

      <div className="flex flex-col gap-1 pt-1 text-xs">
        {canOpen ? (
          <Link
            href={`/shifts/${shift.id}`}
            className="font-medium underline underline-offset-4"
          >
            Open shift
          </Link>
        ) : null}

        {previousPublished ? (
          <Link
            href={`/shifts/${previousPublished.id}/handover`}
            className="font-medium text-emerald-800 underline underline-offset-4 dark:text-emerald-300"
          >
            Previous handover ({previousPublished.name})
          </Link>
        ) : null}
      </div>
    </div>
  );
}
