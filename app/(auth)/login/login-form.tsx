"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signIn } from "../actions";
import { AUTH_FORM_INITIAL_STATE } from "../form-state";
import {
  buttonClass,
  cardClass,
  errorClass,
  inputClass,
  labelClass,
  linkClass,
} from "../ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    signIn,
    AUTH_FORM_INITIAL_STATE,
  );

  return (
    <form action={action} className={cardClass}>
      <input type="hidden" name="next" value={next} />

      <h2 className="text-base font-semibold">Sign in</h2>

      <div className="mt-5 space-y-4">
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
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </div>

        {state.status === "error" ? (
          <p role="alert" className={errorClass}>
            {state.message}
          </p>
        ) : null}

        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </div>

      <p className="mt-5 text-sm text-black/60 dark:text-white/60">
        No account yet?{" "}
        <Link href="/register" className={linkClass}>
          Register
        </Link>
      </p>
    </form>
  );
}
