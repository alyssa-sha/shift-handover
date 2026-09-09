"use server";

import { revalidatePath } from "next/cache";

import {
  type ActionState,
  actionError,
  actionSuccess,
  formValue,
} from "@/lib/action-state";
import { canCreateHandover, evaluateTransition } from "@/lib/handover-state";
import { createClient } from "@/lib/supabase/server";

/**
 * Handover authoring (FR-5).
 *
 * The legality of every move is decided by `lib/handover-state.ts`, and RLS in
 * 0001_init.sql enforces the same rules in the database. These actions only
 * fetch the current row, ask, and write.
 */

function revalidateHandover(shiftId: string): void {
  revalidatePath(`/shifts/${shiftId}/handover`);
  revalidatePath(`/shifts/${shiftId}`);
  revalidatePath("/review");
  revalidatePath("/");
}

/** FR-5.2: creation is an explicit user action, never automatic. */
export async function createHandover(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shiftId = formValue(formData, "shift_id");
  if (!shiftId) return actionError("Missing shift.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return actionError("Your session has expired. Sign in again.");

  const [{ data: profile }, { data: assignment }, { data: existing }] =
    await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase
        .from("shift_assignments")
        .select("id")
        .eq("shift_id", shiftId)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("handovers")
        .select("id")
        .eq("shift_id", shiftId)
        .maybeSingle(),
    ]);

  if (
    !canCreateHandover({
      role: profile?.role,
      isAssigned: Boolean(assignment),
      handoverExists: Boolean(existing),
    })
  ) {
    return actionError(
      existing
        ? "This shift already has a handover."
        : "Only an operator rostered on this shift can create its handover.",
    );
  }

  // One handover per shift is a unique constraint on handovers.shift_id
  // (FR-5.1), so a double click loses the race in the database, not just here.
  const { error } = await supabase.from("handovers").insert({
    shift_id: shiftId,
    author_id: user.id,
    content: "",
    status: "draft",
  });

  if (error) return actionError(error.message);

  revalidateHandover(shiftId);
  return actionSuccess("Handover created.");
}

/**
 * Save a draft or submit for review, depending on which button was pressed.
 *
 * One action rather than two because both write the same textarea: the intent
 * arrives as the submitter button's own name/value, so the form has a single
 * `useActionState` and no duplicated content field.
 */
export async function writeHandover(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const handoverId = formValue(formData, "handover_id");
  const shiftId = formValue(formData, "shift_id");
  const intent = formValue(formData, "intent");

  if (!handoverId || !shiftId) return actionError("Missing handover.");
  if (intent !== "save" && intent !== "submit") {
    return actionError("Unknown action.");
  }

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

  if (!handover || handover.shift_id !== shiftId) {
    return actionError("This handover is no longer available to you.");
  }

  const decision = evaluateTransition({
    action: intent,
    handover: { status: handover.status, authorId: handover.author_id },
    actor: { id: user.id, role: profile?.role ?? "operator" },
    content: formData.get("content")?.toString(),
  });

  if (!decision.ok) return actionError(decision.message);

  const { error, count } = await supabase
    .from("handovers")
    .update(
      {
        content: decision.content ?? "",
        status: decision.nextStatus,
        ...(intent === "submit"
          ? { submitted_at: new Date().toISOString() }
          : {}),
      },
      { count: "exact" },
    )
    .eq("id", handoverId)
    // The status the decision was made against. If a supervisor moved it in the
    // meantime, this matches nothing rather than overwriting their review.
    .eq("status", handover.status);

  if (error) return actionError(error.message);
  if (count === 0) {
    return actionError(
      "This handover changed while you were editing it. Reload the page.",
    );
  }

  revalidateHandover(shiftId);
  return actionSuccess(
    intent === "submit" ? "Submitted for review." : "Draft saved.",
  );
}
