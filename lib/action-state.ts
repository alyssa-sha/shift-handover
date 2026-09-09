/**
 * The shape every Server Action in the app returns to its form.
 *
 * It lives outside the `"use server"` modules on purpose: such a module may
 * only export async functions, so a shared constant or type declared there is a
 * build error (the same reason `app/(auth)/form-state.ts` exists).
 *
 * Actions return an error state rather than throwing. A denied write is a
 * normal outcome here - RLS rejects anything the UI failed to gate - and the
 * operator should see a sentence, not an error page (FR-2.2).
 */
export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message?: string };

export const IDLE_ACTION_STATE: ActionState = { status: "idle" };

export function actionError(message: string): ActionState {
  return { status: "error", message };
}

export function actionSuccess(message?: string): ActionState {
  return { status: "success", message };
}

/** Read a trimmed string out of a submitted form. */
export function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
