import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogEntryList } from "@/components/LogEntryList";
import { ReviewHistory, type ReviewRow } from "@/components/ReviewHistory";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import type { LogEntryRow } from "@/lib/log-entries";
import { formatDateTime, formatDayLabel, formatSlotRange } from "@/lib/shifts";
import { createClient } from "@/lib/supabase/server";

import { cardClass, linkClass, noticeClass, userTextClass } from "../ui";
import { ReviewControls } from "./review-controls";

export const metadata: Metadata = {
  title: "Review queue · Shift Handover",
};

const QUEUE_LIMIT = 100;
const LOG_QUERY_LIMIT = 500;

export default async function ReviewQueuePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(SIGN_IN_PATH);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // UI gating only. The real control is RLS: an operator may not move a
  // handover out of `submitted` whatever they POST (FR-2.3, FR-2.4).
  if (profile?.role !== "supervisor") {
    return (
      <section className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Review queue</h1>
        <p className={noticeClass}>
          Reviewing handovers is a supervisor task. Your own shifts and
          handovers are on the{" "}
          <Link href="/" className={linkClass}>
            calendar
          </Link>
          .
        </p>
      </section>
    );
  }

  // FR-7.1: everything awaiting review, oldest submission first.
  const { data: handoverRows } = await supabase
    .from("handovers")
    .select("id, shift_id, author_id, content, status, submitted_at")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true })
    .limit(QUEUE_LIMIT);

  const handovers = handoverRows ?? [];
  const shiftIds = [...new Set(handovers.map((row) => row.shift_id))];
  const handoverIds = handovers.map((row) => row.id);

  const [shiftResult, entryResult, reviewResult] = await Promise.all([
    shiftIds.length
      ? supabase
          .from("shifts")
          .select("id, location, name, starts_at, ends_at")
          .in("id", shiftIds)
      : Promise.resolve({ data: [] }),
    shiftIds.length
      ? supabase
          .from("log_entries")
          .select("id, shift_id, author_id, severity, content, created_at")
          .in("shift_id", shiftIds)
          .order("created_at", { ascending: false })
          .limit(LOG_QUERY_LIMIT)
      : Promise.resolve({ data: [] }),
    handoverIds.length
      ? supabase
          .from("handover_reviews")
          .select("id, handover_id, decision, feedback, created_at, reviewer_id")
          .in("handover_id", handoverIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const shiftById = new Map(
    (shiftResult.data ?? []).map((shift) => [shift.id, shift]),
  );

  const entriesByShift = new Map<string, LogEntryRow[]>();
  for (const entry of entryResult.data ?? []) {
    const list = entriesByShift.get(entry.shift_id) ?? [];
    list.push(entry);
    entriesByShift.set(entry.shift_id, list);
  }

  const reviewsByHandover = new Map<string, ReviewRow[]>();
  for (const row of reviewResult.data ?? []) {
    const list = reviewsByHandover.get(row.handover_id) ?? [];
    list.push(row);
    reviewsByHandover.set(row.handover_id, list);
  }

  const peopleIds = [
    ...new Set([
      ...handovers.map((row) => row.author_id),
      ...(entryResult.data ?? []).map((row) => row.author_id),
      ...(reviewResult.data ?? []).map((row) => row.reviewer_id),
    ]),
  ];

  const { data: people } = peopleIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", peopleIds)
    : { data: [] };

  const nameById = new Map((people ?? []).map((row) => [row.id, row.full_name]));

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Review queue</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {handovers.length === 0
            ? "Nothing is waiting for review."
            : `${handovers.length} handover${handovers.length === 1 ? "" : "s"} awaiting review, oldest first.`}
        </p>
      </div>

      {handovers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          When an operator submits a handover it appears here, with the shift log
          it was written from.
        </p>
      ) : (
        <ol className="space-y-6">
          {handovers.map((handover) => {
            const shift = shiftById.get(handover.shift_id);
            const entries = entriesByShift.get(handover.shift_id) ?? [];
            const reviews = reviewsByHandover.get(handover.id) ?? [];

            return (
              <li key={handover.id} className={cardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">
                      {shift
                        ? `${shift.location} — ${shift.name}`
                        : "Unknown shift"}
                    </h2>
                    <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                      {shift
                        ? `${formatDayLabel(new Date(shift.starts_at))} · ${formatSlotRange(shift)} · `
                        : ""}
                      {nameById.get(handover.author_id) ?? "Unknown operator"}
                      {handover.submitted_at
                        ? ` · submitted ${formatDateTime(handover.submitted_at)}`
                        : ""}
                    </p>
                  </div>

                  {shift ? (
                    <Link
                      href={`/shifts/${shift.id}`}
                      className={`text-sm ${linkClass}`}
                    >
                      Open shift
                    </Link>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold">Handover</h3>
                      {/*
                        Rendered as text, and read-only: there is no editable
                        field for a supervisor anywhere on this page (FR-7.6).
                        No AI provenance is shown either (FR-6.6).
                      */}
                      <p className={`mt-2 ${userTextClass}`}>
                        {handover.content}
                      </p>
                    </div>

                    <ReviewHistory reviews={reviews} nameById={nameById} />

                    <div className="border-t border-black/10 pt-4 dark:border-white/15">
                      <ReviewControls handoverId={handover.id} />
                    </div>
                  </div>

                  {/* FR-7.2: the shift's log entries, beside the handover. */}
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-sm font-semibold">Shift log</h3>
                      <p className="text-xs text-black/50 dark:text-white/50">
                        {entries.length}{" "}
                        {entries.length === 1 ? "entry" : "entries"}
                      </p>
                    </div>
                    <LogEntryList entries={entries} nameById={nameById} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
