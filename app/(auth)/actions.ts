"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { parseUserRole } from "@/lib/auth/roles";
import { SIGN_IN_PATH, safeRedirectTarget } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

import type { AuthFormState } from "./form-state";

const MIN_PASSWORD_LENGTH = 8;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Absolute origin for the confirmation link Supabase emails out. */
async function siteOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host) return "http://localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function signIn(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  const next = safeRedirectTarget(field(formData, "next") || null);

  if (!email || !password) {
    return { status: "error", message: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", message: error.message };
  }

  redirect(next);
}

export async function register(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  const fullName = field(formData, "full_name");
  const role = parseUserRole(formData.get("role"));
  const next = safeRedirectTarget(field(formData, "next") || null);

  if (!fullName) {
    return { status: "error", message: "Enter your display name." };
  }
  if (!email) {
    return { status: "error", message: "Enter your email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: "error",
      message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (role === null) {
    return { status: "error", message: "Choose operator or supervisor." };
  }

  const supabase = await createClient();
  const origin = await siteOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by the on_auth_user_created trigger, which is what creates the
      // profiles row (FR-1.2). Metadata is the only channel available when
      // confirmation is on and there is no session to insert the row with.
      data: { full_name: fullName, role },
      emailRedirectTo: `${origin}/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  if (!data.session) {
    // Email confirmation is enabled: the account exists but is not usable
    // until the emailed link is followed, which lands on /confirm.
    return { status: "check_email", email };
  }

  // Confirmation is off, so we have a session. The trigger has already created
  // the profile; this is the fallback for a database where it is missing.
  await ensureProfile(fullName, role);

  redirect(next);
}

async function ensureProfile(
  fullName: string,
  role: "operator" | "supervisor",
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return;

  await supabase
    .from("profiles")
    .insert({ id: user.id, full_name: fullName, role });
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(SIGN_IN_PATH);
}
