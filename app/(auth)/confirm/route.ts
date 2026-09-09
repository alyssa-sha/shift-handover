import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { SIGN_IN_PATH, safeRedirectTarget } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function parseOtpType(value: string | null): EmailOtpType | null {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value)
    ? (value as EmailOtpType)
    : null;
}

/**
 * Where Supabase's confirmation email lands (FR-1.5).
 *
 * Inert while email confirmation is off, and the reason turning it on for the
 * demo needs no code change. Handles both link shapes: the PKCE `?code=` that
 * @supabase/ssr issues, and the `?token_hash=&type=` used by projects whose
 * email templates call verifyOtp.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeRedirectTarget(params.get("next"));
  const supabase = await createClient();

  const tokenHash = params.get("token_hash");
  const type = parseOtpType(params.get("type"));
  const code = params.get("code");

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    return NextResponse.redirect(signInWithError(request, error.message));
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    return NextResponse.redirect(signInWithError(request, error.message));
  }

  return NextResponse.redirect(
    signInWithError(
      request,
      params.get("error_description") ??
        "That confirmation link is invalid or has expired. Sign in to request a new one.",
    ),
  );
}

function signInWithError(request: NextRequest, message: string): URL {
  const url = new URL(SIGN_IN_PATH, request.url);
  url.searchParams.set("error", message);
  return url;
}
