import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LogEntryList } from "@/components/LogEntryList";
import { ReviewHistory } from "@/components/ReviewHistory";
import { SlotStatusBadge } from "@/components/SlotStatusBadge";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import {
  canCreateHandover,
  canEditHandover,
  handoverStatusLabel,
} from "@/lib/handover-state";
import { formatDateTime, formatDayLabel, formatSlotRange } from "@/lib/shifts";
import { createClient } from "@/lib/supabase/server";

import {
  cardClass,
  linkClass,
  noticeClass,
  userTextClass,
} from "../../../ui";
import { CreateHandoverForm } from "./create-handover-form";
import { HandoverEditor } from "./handover-editor";

const LOG_QUERY_LIMIT = 200;

export default async function HandoverPage(
  props: PageProps<"/shifts/[id]/handover">,
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

  if (!shift) notFound();

  const [{ data: profile }, { data: assignment }, { data: handover }] =
    await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase
        .from("shift_assignments")
        .select("id")
        .eq("shift_id", shift.id)
        .eq("user_id", user.id)
        .maybeSingle(),
      // RLS returns this row to a supervisor, to an assigned operator, and to
      // the incoming shift's operators once it is approved - nobody else.
      supabase
        .from("handovers")
        .select(
          "id, shift_id, author_id, content, status, submitted_at, reviewed_at, updated_at",
        )
        .eq("shift_id", id)
        .maybeSingle(),
    ]);

  const isAssigned = Boolean(assignment);
  const isSupervisor = profile?.role === "supervisor";

  const { data: entryRows } = await supabase
    .from("log_entries")
    .select("id, shift_id, author_id, severity, content, created_at")
    .eq("shift_id", shift.id)
    .order("created_at", { ascending: false })
    .limit(LOG_QUERY_LIMIT);

  const entries = entryRows ?? [];

  // Feedback rounds. Readable by a supervisor or by the shift's own operators;
  // an incoming operator reading a published handover sees none, by design.
  const { data: reviewRows } = handover
    ? await supabase
        .from("handover_reviews")
        .select("id, decision, feedback, created_at, reviewer_id")
        .eq("handover_id", handover.id)
        .order("created_at", { ascending: true })
    : { data: [] };

  const reviews = reviewRows ?? [];

  const peopleIds = [
    ...new Set(
      [
        handover?.author_id,
        ...entries.map((entry) => entry.author_id),
        ...reviews.map((review) => review.reviewer_id),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];

  const { data: people } = peopleIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", peopleIds)
    : { data: [] };

  const nameById = new Map((people ?? []).map((row) => [row.id, row.full_name]));

  const editable = handover
    ? canEditHandover(
        { status: handover.status, authorId: handover.author_id },
        { id: user.id },
      )
    : false;

  const showCreate = canCreateHandover({
    role: profile?.role,
    isAssigned,
    handoverExists: Boolean(handover),
  });

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/shifts/${shift.id}`} className={`text-sm ${linkClass}`}>
            ← {shift.location} — {shift.name}
          </Link>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">Handover</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {formatDayLabel(new Date(shift.starts_at))} ·{" "}
            {formatSlotRange(shift)}
            {handover
              ? ` · ${nameById.get(handover.author_id) ?? "Unknown operator"}`
              : ""}
          </p>
        </div>

        {handover ? <SlotStatusBadge status={handover.status} /> : null}
      </div>

      {!handover ? (
        <div className={cardClass}>
          <h2 className="text-base font-semibold">
            No handover for this shift yet
          </h2>
          {showCreate ? (
            <>
              <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                Creating it opens an empty draft. Nothing is sent to a supervisor
                until you submit it.
              </p>
              <div className="mt-4">
                <CreateHandoverForm shiftId={shift.id} />
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              {isSupervisor
                ? "The rostered operator has not created it yet. Supervisors review handovers; they do not author them."
                : isAssigned
                  ? "Only an operator rostered on this shift can create its handover."
                  : "You are not rostered on this shift, so its handover is not visible to you."}
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            {handover.status === "changes_requested" ? (
              <p className={noticeClass}>
                A supervisor has asked for changes. Their feedback is below; edit
                the handover and submit it again.
              </p>
            ) : null}

            {editable ? (
              <div className={cardClass}>
                <HandoverEditor
                  handoverId={handover.id}
                  shiftId={shift.id}
                  initialContent={handover.content}
                />
              </div>
            ) : (
              <div className={cardClass}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold">
                    {handoverStatusLabel(handover.status)}
                  </h2>
                  <p className="text-xs text-black/55 dark:text-white/55">
                    {handover.submitted_at
                      ? `Submitted ${formatDateTime(handover.submitted_at)}`
                      : null}
                    {handover.reviewed_at
                      ? ` · Reviewed ${formatDateTime(handover.reviewed_at)}`
                      : null}
                  </p>
                </div>

                {/* FR-5.6: read-only once submitted. Rendered as text. */}
                {handover.content.trim().length > 0 ? (
                  <p className={`mt-3 ${userTextClass}`}>{handover.content}</p>
                ) : (
                  <p className="mt-3 text-sm text-black/50 dark:text-white/50">
                    This handover is empty.
                  </p>
                )}

                {handover.status === "submitted" &&
                handover.author_id === user.id ? (
                  <p className="mt-4 text-xs text-black/55 dark:text-white/55">
                    With a supervisor for review. It becomes editable again only
                    if they ask for changes.
                  </p>
                ) : null}
              </div>
            )}

            <ReviewHistory reviews={reviews} nameById={nameById} />
          </div>

          {/* FR-5.5: the shift's log entries sit beside the content field. */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold">Shift log</h2>
              <p className="text-xs text-black/50 dark:text-white/50">
                {entries.length} {entries.length === 1 ? "entry" : "entries"}
              </p>
            </div>
            <LogEntryList entries={entries} nameById={nameById} />
          </div>
        </div>
      )}
    </section>
  );
}
