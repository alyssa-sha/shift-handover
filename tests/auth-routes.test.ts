import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIGNED_IN_PATH,
  NEXT_PARAM,
  SIGN_IN_PATH,
  isPublicPath,
  resolveAuthRedirect,
  safeRedirectTarget,
} from "@/lib/auth/routes";

describe("isPublicPath", () => {
  it("lets the auth routes through", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/register")).toBe(true);
    expect(isPublicPath("/confirm")).toBe(true);
  });

  it("matches on path segments, not string prefixes", () => {
    // "/loginsomething" must not inherit "/login"'s public status.
    expect(isPublicPath("/loginsomething")).toBe(false);
    expect(isPublicPath("/registered")).toBe(false);
    expect(isPublicPath("/confirm/anything")).toBe(true);
  });

  it("protects everything else", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/shifts/abc")).toBe(false);
    expect(isPublicPath("/review")).toBe(false);
  });
});

describe("safeRedirectTarget", () => {
  it("keeps a same-site path, query string and all", () => {
    expect(safeRedirectTarget("/shifts/abc?tab=logs")).toBe(
      "/shifts/abc?tab=logs",
    );
  });

  it("falls back when there is nothing to redirect to", () => {
    expect(safeRedirectTarget(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectTarget(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectTarget("")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses to be turned into an open redirect", () => {
    expect(safeRedirectTarget("https://evil.example/steal")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
    // Protocol-relative: the browser reads "//evil.example" as another origin.
    expect(safeRedirectTarget("//evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    // Some browsers normalise a backslash to a slash.
    expect(safeRedirectTarget("/\\evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectTarget("javascript:alert(1)")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("honours an explicit fallback", () => {
    expect(safeRedirectTarget(null, "/review")).toBe("/review");
  });
});

describe("resolveAuthRedirect", () => {
  it("sends unauthenticated traffic to the sign-in page (FR-1.3)", () => {
    expect(
      resolveAuthRedirect({ pathname: "/", isAuthenticated: false }),
    ).toBe(SIGN_IN_PATH);
  });

  it("remembers where an unauthenticated user was going", () => {
    const redirect = resolveAuthRedirect({
      pathname: "/shifts/abc",
      search: "?tab=logs",
      isAuthenticated: false,
    });

    expect(redirect).toBe(
      `${SIGN_IN_PATH}?${NEXT_PARAM}=${encodeURIComponent("/shifts/abc?tab=logs")}`,
    );
  });

  it("produces a ?next= that survives the open redirect guard", () => {
    // The two halves of the round trip have to agree, or sign-in silently
    // drops the user on the calendar instead of where they were headed.
    const redirect = resolveAuthRedirect({
      pathname: "/shifts/abc",
      search: "?tab=logs",
      isAuthenticated: false,
    });

    const next = new URLSearchParams(redirect!.split("?")[1]).get(NEXT_PARAM);
    expect(safeRedirectTarget(next)).toBe("/shifts/abc?tab=logs");
  });

  it("lets unauthenticated users reach the public routes", () => {
    for (const pathname of ["/login", "/register", "/confirm"]) {
      expect(resolveAuthRedirect({ pathname, isAuthenticated: false })).toBeNull();
    }
  });

  it("lets the confirmation callback run even with a session", () => {
    // Redirecting /confirm away would break the emailed link (FR-1.5).
    expect(
      resolveAuthRedirect({
        pathname: "/confirm",
        search: "?code=abc",
        isAuthenticated: true,
      }),
    ).toBeNull();
  });

  it("bounces a signed-in user off the auth forms", () => {
    expect(
      resolveAuthRedirect({ pathname: "/login", isAuthenticated: true }),
    ).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(
      resolveAuthRedirect({ pathname: "/register", isAuthenticated: true }),
    ).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("leaves a signed-in user on an application route", () => {
    expect(
      resolveAuthRedirect({ pathname: "/", isAuthenticated: true }),
    ).toBeNull();
    expect(
      resolveAuthRedirect({ pathname: "/shifts/abc", isAuthenticated: true }),
    ).toBeNull();
  });
});
