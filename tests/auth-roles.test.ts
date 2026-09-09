import { describe, expect, it } from "vitest";

import { USER_ROLES, parseUserRole, roleLabel } from "@/lib/auth/roles";

describe("parseUserRole", () => {
  it("accepts the two roles in scope", () => {
    expect(parseUserRole("operator")).toBe("operator");
    expect(parseUserRole("supervisor")).toBe("supervisor");
  });

  it("normalises casing and surrounding whitespace", () => {
    // Registration reads this from a form field and from Supabase sign-up
    // metadata, neither of which is guaranteed to be tidy.
    expect(parseUserRole("  Supervisor ")).toBe("supervisor");
    expect(parseUserRole("OPERATOR")).toBe("operator");
  });

  it("rejects a role that is not in scope", () => {
    // requirement.md section 2: exactly two roles, no admin.
    expect(parseUserRole("admin")).toBeNull();
    expect(parseUserRole("supervisor ")).toBe("supervisor");
    expect(parseUserRole("super")).toBeNull();
  });

  it("rejects non-string and empty input", () => {
    expect(parseUserRole(null)).toBeNull();
    expect(parseUserRole(undefined)).toBeNull();
    expect(parseUserRole("")).toBeNull();
    expect(parseUserRole(["operator"])).toBeNull();
    expect(parseUserRole({ role: "operator" })).toBeNull();
  });
});

describe("roleLabel", () => {
  it("labels every role in USER_ROLES", () => {
    for (const role of USER_ROLES) {
      expect(roleLabel(role)).not.toHaveLength(0);
    }
    expect(roleLabel("operator")).toBe("Operator");
    expect(roleLabel("supervisor")).toBe("Supervisor");
  });
});
