import type { Metadata } from "next";

import { safeRedirectTarget } from "@/lib/auth/routes";

import { errorClass } from "../ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Shift Handover",
};

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = safeRedirectTarget(first(searchParams.next));
  const error = first(searchParams.error);

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      <LoginForm next={next} />
    </div>
  );
}
