/**
 * The handover state machine (FR-5.3, FR-5.4, FR-5.6, FR-7.3, FR-7.4, FR-7.6).
 *
 *     draft ──submit──▶ submitted ──approve──────────▶ approved
 *       ▲                    │
 *       │                    └─request changes─▶ changes_requested
 *       └────────────────────── save ───────────────────┘
 *
 * Pure functions over plain data: no Supabase, no React. The Server Actions in
 * `app/(app)/shifts/[id]/handover/actions.ts` and `app/(app)/review/actions.ts`
 * ask this module whether a move is legal, then perform it; RLS in
 * 0001_init.sql enforces the same rules in the database (FR-2.4).
 *
 * One transition deserves a note. Saving a revision while the handover is in
 * `changes_requested` returns it to `draft` rather than leaving it where it is.
 * That is not a design preference: the RLS policy `handovers_update_author` has
 * `using (status in ('draft','changes_requested'))` but
 * `with check (status in ('draft','submitted'))`, so an author-written row can
 * never come out of an update still in `changes_requested`. The supervisor's
 * feedback is not lost by this - it lives in `handover_reviews`, which is
 * append-only, and the editor keeps showing every round (FR-7.5).
 */

import type { HandoverStatus, UserRole } from "@/lib/types/database";

export const HANDOVER_CONTENT_MIN_LENGTH = 1;
export const HANDOVER_CONTENT_MAX_LENGTH = 20000;

export const HANDOVER_STATUS_LABEL: Record<HandoverStatus, string> = {
  draft: "Draft",
  submitted: "Submitted for review",
  changes_requested: "Changes requested",
  // Approval is publication (decision D2).
  approved: "Published",
};

export function handoverStatusLabel(status: HandoverStatus): string {
  return HANDOVER_STATUS_LABEL[status];
}

/** The statuses whose content the author may still write to. */
export const AUTHOR_EDITABLE_STATUSES: readonly HandoverStatus[] = [
  "draft",
  "changes_requested",
];

/** The only status a supervisor may act on (FR-2.3, FR-7.1). */
export const REVIEWABLE_STATUS: HandoverStatus = "submitted";

export type HandoverAction =
  /** Author saves content without asking for review. */
  | "save"
  /** Author sends it to a supervisor. */
  | "submit"
  /** Supervisor approves, which publishes it. */
  | "approve"
  /** Supervisor returns it with feedback. */
  | "request_changes";

export type Actor = { id: string; role: UserRole };

export type HandoverSnapshot = { status: HandoverStatus; authorId: string };

export type TransitionFailure =
  | "not_author"
  | "not_supervisor"
  | "wrong_status"
  | "empty_content"
  | "content_too_long"
  | "empty_feedback";

export type TransitionRequest = {
  action: HandoverAction;
  handover: HandoverSnapshot;
  actor: Actor;
  /** Required for `save` and `submit`. */
  content?: string;
  /** Required for `request_changes` (FR-7.4). */
  feedback?: string;
};

export type TransitionResult =
  | {
      ok: true;
      nextStatus: HandoverStatus;
      /** Trimmed content to write, for author actions. */
      content?: string;
      /** Trimmed feedback to record, for `request_changes`. */
      feedback?: string;
    }
  | { ok: false; reason: TransitionFailure; message: string };

function fail(reason: TransitionFailure, message: string): TransitionResult {
  return { ok: false, reason, message };
}

function trimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * FR-5.4: content is free text of 1-20000 characters, required to be non-empty
 * at submission. A draft may be saved empty - the operator has not committed to
 * anything yet - but it can never be submitted empty.
 */
export function validateHandoverContent(
  value: unknown,
  { allowEmpty }: { allowEmpty: boolean },
):
  | { ok: true; content: string }
  | { ok: false; reason: TransitionFailure; message: string } {
  const content = typeof value === "string" ? value.trim() : "";

  if (!allowEmpty && content.length < HANDOVER_CONTENT_MIN_LENGTH) {
    return {
      ok: false,
      reason: "empty_content",
      message: "Write the handover before submitting it for review.",
    };
  }
  if (content.length > HANDOVER_CONTENT_MAX_LENGTH) {
    return {
      ok: false,
      reason: "content_too_long",
      message: `Keep the handover to ${HANDOVER_CONTENT_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, content };
}

/**
 * The single decision point: may `actor` perform `action` on this handover, and
 * what status does it land in?
 */
export function evaluateTransition({
  action,
  handover,
  actor,
  content,
  feedback,
}: TransitionRequest): TransitionResult {
  switch (action) {
    case "save":
    case "submit": {
      if (actor.id !== handover.authorId) {
        return fail(
          "not_author",
          "Only the operator who wrote this handover can change it.",
        );
      }
      if (!AUTHOR_EDITABLE_STATUSES.includes(handover.status)) {
        return fail(
          "wrong_status",
          handover.status === "submitted"
            ? "This handover is with a supervisor and is read-only until they respond."
            : "This handover has been published and can no longer be changed.",
        );
      }

      const validated = validateHandoverContent(content, {
        allowEmpty: action === "save",
      });
      if (!validated.ok) return fail(validated.reason, validated.message);

      return {
        ok: true,
        // A saved revision returns to `draft`; see the note at the top of the
        // file - RLS will not accept a row still in `changes_requested`.
        nextStatus: action === "save" ? "draft" : "submitted",
        content: validated.content,
      };
    }

    case "approve":
    case "request_changes": {
      if (actor.role !== "supervisor") {
        return fail(
          "not_supervisor",
          "Only a supervisor can review a handover.",
        );
      }
      if (handover.status !== REVIEWABLE_STATUS) {
        return fail(
          "wrong_status",
          "This handover is not awaiting review. Refresh the queue.",
        );
      }

      if (action === "approve") {
        return { ok: true, nextStatus: "approved" };
      }

      const text = trimmed(feedback);
      if (text.length === 0) {
        return fail(
          "empty_feedback",
          "Say what needs changing before sending the handover back.",
        );
      }
      return { ok: true, nextStatus: "changes_requested", feedback: text };
    }
  }
}

// -----------------------------------------------------------------------------
// UI predicates. Convenience only - each has a policy behind it (FR-2.4).
// -----------------------------------------------------------------------------

/** FR-5.2: an assigned operator creates the handover, by an explicit click. */
export function canCreateHandover({
  role,
  isAssigned,
  handoverExists,
}: {
  role: UserRole | null | undefined;
  isAssigned: boolean;
  handoverExists: boolean;
}): boolean {
  return role === "operator" && isAssigned && !handoverExists;
}

/** FR-5.6: read-only to everyone but the author, and only while editable. */
export function canEditHandover(
  handover: HandoverSnapshot,
  actor: Pick<Actor, "id">,
): boolean {
  return (
    actor.id === handover.authorId &&
    AUTHOR_EDITABLE_STATUSES.includes(handover.status)
  );
}

/** FR-7.1: the review queue acts on submitted handovers only. */
export function canReviewHandover(
  handover: HandoverSnapshot,
  actor: Pick<Actor, "role">,
): boolean {
  return actor.role === "supervisor" && handover.status === REVIEWABLE_STATUS;
}

/** True once the handover is published, i.e. visible to the incoming shift. */
export function isPublished(status: HandoverStatus): boolean {
  return status === "approved";
}
