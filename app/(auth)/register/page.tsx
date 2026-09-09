import type { Metadata } from "next";

import { safeRedirectTarget } from "@/lib/auth/routes";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Register · Shift Handover",
};

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function RegisterPage(props: PageProps<"/register">) {
  const searchParams = await props.searchParams;
  const next = safeRedirectTarget(first(searchParams.next));

  return <RegisterForm next={next} />;
}
