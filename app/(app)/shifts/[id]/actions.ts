"use server";

import { revalidatePath } from "next/cache";

import {
  type ActionState,
  actionError,
  actionSuccess,
  formValue,
} from "@/lib/action-state";
import { isShiftLogOpen, parseSeverity, validateLogContent } from "@/lib/log-entries";
import { createClient } from "@/lib/supabase/server";

/**
 * Log entry create / edit / delete (FR-3.1, FR-3.2, FR-3.5).
 *
 * Every check here has a matching RLS policy in 0001_init.sql - assignment,
 * authorship, the submitted-handover freeze and the content bounds are all
 * enforced in the database as well (FR-2.4). These checks exist to turn a
 * denial into a readable sentence instead of a failed insert, and they are
 * never the only gate: a Server Action is reachable by direct POST.
 */

type ShiftContext = {
  userId: string;
  isOperator: boolean;
  isAssigned: boolean;
  logOpen: boolean;
};

async function loadShiftContext(
  shiftId: string,
): Promise<ShiftContext | ActionState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return actionError("Your session has expired. Sign in again.");

  const [{ data: profile }, { data: assignment }, { data: handover }] =
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
        .select("status")
        .eq("shift_id", shiftId)
        .maybeSingle(),
    ]);

  return {
    userId: user.id,
    isOperator: profile?.role === "operator",
    isAssigned: Boolean(assignment),
    logOpen: isShiftLogOpen(handover?.status),
  };
}

function isActionState(value: ShiftContext | ActionState): value is ActionState {
  return "status" in value;
}

/** The two refusals shared by every write on a shift's log. */
function refuse(context: ShiftContext): ActionState | null {
  if (!context.isOperator || !context.isAssigned) {
    return actionError(
      "You are not assigned to this shift, so you cannot change its log.",
    );
  }
  if (!context.logOpen) {
    return actionError(
      "The handover for this shift has been submitted, so its log entries are now read-only.",
    );
  }
  return null;
}

function revalidateShift(shiftId: string): void {
  revalidatePath(`/shifts/${shiftId}`);
  revalidatePath(`/shifts/${shiftId}/handover`);
  revalidatePath("/");
}

export async function createLogEntry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shiftId = formValue(formData, "shift_id");
  if (!shiftId) return actionError("Missing shift.");

  const severity = parseSeverity(formData.get("severity"));
  if (severity === null) {
    return actionError("Choose info, warning or critical.");
  }

  const content = validateLogContent(formData.get("content"));
  if (!content.ok) return actionError(content.message);

  const context = await loadShiftContext(shiftId);
  if (isActionState(context)) return context;
  const refusal = refuse(context);
  if (refusal) return refusal;

  const supabase = await createClient();
  const { error } = await supabase.from("log_entries").insert({
    shift_id: shiftId,
    author_id: context.userId,
    severity,
    content: content.content,
  });

  if (error) return actionError(error.message);

  revalidateShift(shiftId);
  return actionSuccess("Entry added.");
}

export async function updateLogEntry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const entryId = formValue(formData, "entry_id");
  const shiftId = formValue(formData, "shift_id");
  if (!entryId || !shiftId) return actionError("Missing entry.");

  const severity = parseSeverity(formData.get("severity"));
  if (severity === null) {
    return actionError("Choose info, warning or critical.");
  }

  const content = validateLogContent(formData.get("content"));
  if (!content.ok) return actionError(content.message);

  const context = await loadShiftContext(shiftId);
  if (isActionState(context)) return context;
  const refusal = refuse(context);
  if (refusal) return refusal;

  const supabase = await createClient();
  // author_id is in the filter as well as the policy: an operator may only
  // touch their own entry (FR-3.5).
  const { error, count } = await supabase
    .from("log_entries")
    .update({ severity, content: content.content }, { count: "exact" })
    .eq("id", entryId)
    .eq("shift_id", shiftId)
    .eq("author_id", context.userId);

  if (error) return actionError(error.message);
  if (count === 0) {
    return actionError("That entry is not yours to edit, or no longer exists.");
  }

  revalidateShift(shiftId);
  return actionSuccess("Entry updated.");
}

export async function deleteLogEntry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const entryId = formValue(formData, "entry_id");
  const shiftId = formValue(formData, "shift_id");
  if (!entryId || !shiftId) return actionError("Missing entry.");

  const context = await loadShiftContext(shiftId);
  if (isActionState(context)) return context;
  const refusal = refuse(context);
  if (refusal) return refusal;

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("log_entries")
    .delete({ count: "exact" })
    .eq("id", entryId)
    .eq("shift_id", shiftId)
    .eq("author_id", context.userId);

  if (error) return actionError(error.message);
  if (count === 0) {
    return actionError("That entry is not yours to delete, or is already gone.");
  }

  revalidateShift(shiftId);
  return actionSuccess("Entry deleted.");
}
