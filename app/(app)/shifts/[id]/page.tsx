import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SlotStatusBadge } from "@/components/SlotStatusBadge";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { isShiftLogOpen, sortNewestFirst } from "@/lib/log-entries";
import {
  deriveSlotStatus,
  formatDateTime,
  formatSlotRange,
  formatDayLabel,
} from "@/lib/shifts";
import { createClient } from "@/lib/supabase/server";

import { cardClass, linkClass, noticeClass } from "../../ui";
import { LogEntryForm } from "./log-entry-form";
import { LogEntryItem } from "./log-entry-item";

/** Demo scale (§9.4): a sensible ceiling, no pagination. */
const LOG_QUERY_LIMIT = 200;

export default async function ShiftDetailPage(
  props: PageProps<"/shifts/[id]">,
) {
  const { id } = await props.params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(SIGN_IN_PATH);

  const { data: shift } = await supabase
    .from("shifts")
    .select("id, location, name, starts_at, ends_at")
    .eq("id", id)
    .maybeSingle();

  // Every authenticated user may read the shift row itself; a bad id or a
  // deleted shift is a 404 rather than a crash.
  if (!shift) notFound();

  const [{ data: profile }, { data: assignments }, { data: handover }] =
    await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase
        .from("shift_assignments")
        .select("user_id")
        .eq("shift_id", shift.id),
      supabase
        .from("handovers")
        .select("id, status, author_id, submitted_at")
        .eq("shift_id", shift.id)
        .maybeSingle(),
    ]);

  const isSupervisor = profile?.role === "supervisor";
  const isOperator = profile?.role === "operator";
  const isAssigned = (assignments ?? []).some((row) => row.user_id === user.id);

  // RLS decides what comes back here. An operator who is not assigned to this
  // shift, and is not the incoming shift for a published handover, gets zero
  // rows - which is the acceptance criterion for FR-2.2, not an error page.
  const { data: entryRows } = await supabase
    .from("log_entries")
    .select("id, shift_id, author_id, severity, content, created_at")
    .eq("shift_id", shift.id)
    .order("created_at", { ascending: false })
    .limit(LOG_QUERY_LIMIT);

  const entries = sortNewestFirst(entryRows ?? []);

  const peopleIds = [
    ...new Set([
      ...(assignments ?? []).map((row) => row.user_id),
      ...entries.map((entry) => entry.author_id),
    ]),
  ];

  const { data: people } = peopleIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", peopleIds)
    : { data: [] };

  const nameById = new Map(
    (people ?? []).map((row) => [row.id, row.full_name]),
  );

  const crew = (assignments ?? []).map(
    (row) => nameById.get(row.user_id) ?? "Unknown user",
  );

  const logOpen = isShiftLogOpen(handover?.status);
  const canWriteLog = isOperator && isAssigned && logOpen;
  const canSeeHandover = isSupervisor || isAssigned || handover !== null;

  const status = deriveSlotStatus({
    canReadHandover: canSeeHandover,
    handoverStatus: handover?.status ?? null,
  });

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className={`text-sm ${linkClass}`}>
            ← Calendar
          </Link>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">
            {shift.location} — {shift.name}
          </h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {formatDayLabel(new Date(shift.starts_at))} ·{" "}
            {formatSlotRange(shift)}
          </p>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {crew.length > 0 ? `Rostered: ${crew.join(", ")}` : "Unrostered"}
          </p>
        </div>

        <SlotStatusBadge status={status} />
      </div>

      {!isSupervisor && !isAssigned ? (
        <p className={noticeClass}>
          {entries.length > 0 || handover
            ? "You are not rostered on this shift. You can read it because you are on the shift that follows it and its handover has been published."
            : "You are not rostered on this shift, so its log entries and handover are not visible to you."}
        </p>
      ) : null}

      <div className={cardClass}>
        <h2 className="text-base font-semibold">Handover</h2>
        {canSeeHandover ? (
          <>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              {handover
                ? `Status: ${status === "approved" ? "published" : status.replace("_", " ")}.`
                : "No handover has been created for this shift yet."}
              {handover?.submitted_at
                ? ` Submitted ${formatDateTime(handover.submitted_at)}.`
                : ""}
            </p>
            <p className="mt-3 text-sm">
              <Link href={`/shifts/${shift.id}/handover`} className={linkClass}>
                {handover ? "Open handover" : "Go to handover"}
              </Link>
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Not visible to you.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">Shift log</h2>
            <p className="text-xs text-black/50 dark:text-white/50">
              Newest first · {entries.length}{" "}
              {entries.length === 1 ? "entry" : "entries"}
            </p>
          </div>

          {entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
              No log entries to show.
            </p>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry) => (
                <LogEntryItem
                  key={entry.id}
                  entry={entry}
                  authorName={nameById.get(entry.author_id) ?? "Unknown user"}
                  createdAtLabel={formatDateTime(entry.created_at)}
                  canManage={canWriteLog && entry.author_id === user.id}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-semibold">Add an entry</h2>
          {canWriteLog ? (
            <div className={cardClass}>
              <LogEntryForm shiftId={shift.id} />
            </div>
          ) : (
            <p className={noticeClass}>
              {isOperator && isAssigned
                ? "The handover for this shift has been submitted, so the log is now read-only (FR-3.5)."
                : isSupervisor
                  ? "Supervisors review handovers; log entries are written by the rostered operators."
                  : "Only the operators rostered on this shift can add entries."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
