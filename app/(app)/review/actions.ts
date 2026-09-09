"use server";

import { revalidatePath } from "next/cache";

import {
  type ActionState,
  actionError,
  actionSuccess,
  formValue,
} from "@/lib/action-state";
import { evaluateTransition } from "@/lib/handover-state";
import { createClient } from "@/lib/supabase/server";
import type { ReviewDecision } from "@/lib/types/database";

/**
 * Supervisor review (FR-7).
 *
 * Approve publishes the handover and stamps `reviewed_by` / `reviewed_at`
 * (FR-7.3); request-revision returns it with mandatory feedback (FR-7.4). Both
 * write a `handover_reviews` row, which is append-only, so a handover revised
 * twice keeps both rounds (FR-7.5).
 *
 * Neither action sends `content`. A supervisor has no path to edit the text
 * (FR-7.6), and the `handovers_before_update` trigger would reject it anyway.
 */

async function review(
  formData: FormData,
  decision: ReviewDecision,
): Promise<ActionState> {
  const handoverId = formValue(formData, "handover_id");
  if (!handoverId) return actionError("Missing handover.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return actionError("Your session has expired. Sign in again.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const { data: handover } = await supabase
    .from("handovers")
    .select("id, shift_id, author_id, status")
    .eq("id", handoverId)
    .maybeSingle();

  if (!handover) {
    return actionError("That handover is no longer available.");
  }

  const outcome = evaluateTransition({
    action: decision === "approved" ? "approve" : "request_changes",
    handover: { status: handover.status, authorId: handover.author_id },
    actor: { id: user.id, role: profile?.role ?? "operator" },
    feedback: formData.get("feedback")?.toString(),
  });

  if (!outcome.ok) return actionError(outcome.message);

  const reviewedAt = new Date().toISOString();

  // The status filter is the race guard: whichever supervisor gets here first
  // moves it out of `submitted`, and the second one matches zero rows instead
  // of reviewing it twice. Done before the handover_reviews insert so a lost
  // race cannot leave a review row describing a decision that never happened.
  const { error: updateError, count } = await supabase
    .from("handovers")
    .update(
      {
        status: outcome.nextStatus,
        reviewed_by: user.id,
        reviewed_at: reviewedAt,
      },
      { count: "exact" },
    )
    .eq("id", handover.id)
    .eq("status", "submitted");

  if (updateError) return actionError(updateError.message);
  if (count === 0) {
    return actionError(
      "This handover is no longer awaiting review - somebody else may have just reviewed it.",
    );
  }

  const { error: reviewError } = await supabase.from("handover_reviews").insert({
    handover_id: handover.id,
    reviewer_id: user.id,
    decision,
    feedback: outcome.feedback ?? null,
  });

  revalidatePath("/review");
  revalidatePath(`/shifts/${handover.shift_id}/handover`);
  revalidatePath(`/shifts/${handover.shift_id}`);
  revalidatePath("/");

  if (reviewError) {
    // The decision itself is recorded on the handover and the operator has been
    // notified by the trigger; only the feedback record failed to write. Say so
    // rather than reporting a clean success.
    return actionError(
      `The decision was saved, but the feedback record failed to write: ${reviewError.message}`,
    );
  }

  return actionSuccess(
    decision === "approved"
      ? "Approved and published."
      : "Sent back to the operator.",
  );
}

export async function approveHandover(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return review(formData, "approved");
}

export async function requestRevision(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return review(formData, "changes_requested");
}
