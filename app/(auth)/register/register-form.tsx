"use client";

import Link from "next/link";
import { useActionState } from "react";

import { USER_ROLES, roleLabel } from "@/lib/auth/roles";

import { register } from "../actions";
import { AUTH_FORM_INITIAL_STATE } from "../form-state";
import {
  buttonClass,
  cardClass,
  errorClass,
  inputClass,
  labelClass,
  linkClass,
} from "../ui";

export function RegisterForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    register,
    AUTH_FORM_INITIAL_STATE,
  );

  /*
   * Supabase email confirmation may be off (a session comes back and the action
   * redirects) or on (no session comes back). This branch is the whole
   * difference between the two modes - there is no second code path (FR-1.5).
   */
  if (state.status === "check_email") {
    return (
      <div className={cardClass}>
        <h2 className="text-base font-semibold">Check your inbox</h2>
        <p className="mt-3 text-sm text-black/70 dark:text-white/70">
          We sent a confirmation link to{" "}
          <span className="font-medium">{state.email}</span>. Open it to finish
          setting up your account, and you will be signed in automatically.
        </p>
        <p className="mt-4 text-sm text-black/60 dark:text-white/60">
          Already confirmed?{" "}
          <Link href="/login" className={linkClass}>
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className={cardClass}>
      <input type="hidden" name="next" value={next} />

      <h2 className="text-base font-semibold">Create an account</h2>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="full_name" className={labelClass}>
            Display name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClass}
          />
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            At least 8 characters.
          </p>
        </div>

        <fieldset>
          <legend className={labelClass}>Role</legend>
          <div className="mt-2 space-y-2">
            {USER_ROLES.map((role, index) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="role"
                  value={role}
                  defaultChecked={index === 0}
                  required
                />
                {roleLabel(role)}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Operators record logs and write handovers. Supervisors review them.
            This cannot be changed later.
          </p>
        </fieldset>

        {state.status === "error" ? (
          <p role="alert" className={errorClass}>
            {state.message}
          </p>
        ) : null}

        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </div>

      <p className="mt-5 text-sm text-black/60 dark:text-white/60">
        Already have an account?{" "}
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
