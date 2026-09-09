/**
 * State shared between the auth Server Actions and the forms that call them.
 *
 * Separate from actions.ts because a "use server" module may only export async
 * functions - a plain constant there is a build error.
 *
 * `check_email` is the state that makes FR-1.5 work in both directions: with
 * Supabase email confirmation OFF, signUp returns a session and the action
 * redirects; with it ON, signUp returns no session and the form shows this
 * state instead of looking like a failure. No code change moves between them.
 */
export type AuthFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "check_email"; email: string };

export const AUTH_FORM_INITIAL_STATE: AuthFormState = { status: "idle" };
