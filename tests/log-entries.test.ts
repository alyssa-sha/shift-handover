import { describe, expect, it } from "vitest";

import {
  LOG_CONTENT_MAX_LENGTH,
  SEVERITIES,
  isShiftLogOpen,
  parseSeverity,
  severityLabel,
  severityRank,
  sortNewestFirst,
  validateLogContent,
} from "@/lib/log-entries";

describe("parseSeverity", () => {
  it("accepts the three severities in scope (decision D1)", () => {
    expect(SEVERITIES).toEqual(["info", "warning", "critical"]);
    expect(parseSeverity("info")).toBe("info");
    expect(parseSeverity("warning")).toBe("warning");
    expect(parseSeverity("critical")).toBe("critical");
  });

  it("normalises casing and whitespace from a form field", () => {
    expect(parseSeverity(" Critical ")).toBe("critical");
    expect(parseSeverity("INFO")).toBe("info");
  });

  it("rejects anything else rather than defaulting silently", () => {
    expect(parseSeverity("urgent")).toBeNull();
    expect(parseSeverity("")).toBeNull();
    expect(parseSeverity(null)).toBeNull();
    expect(parseSeverity(3)).toBeNull();
    expect(parseSeverity(["critical"])).toBeNull();
  });
});

describe("severityLabel / severityRank", () => {
  it("gives every severity a text label, so colour is never the only signal", () => {
    // FR-3.3.
    expect(severityLabel("info")).toBe("Info");
    expect(severityLabel("warning")).toBe("Warning");
    expect(severityLabel("critical")).toBe("Critical");
  });

  it("ranks severity in ascending urgency", () => {
    expect(severityRank("info")).toBeLessThan(severityRank("warning"));
    expect(severityRank("warning")).toBeLessThan(severityRank("critical"));
  });
});

describe("validateLogContent", () => {
  it("accepts content within 1-2000 characters and stores it trimmed", () => {
    const result = validateLogContent("  Gate 42 stand blocked  ");
    expect(result).toEqual({ ok: true, content: "Gate 42 stand blocked" });
  });

  it("rejects empty and whitespace-only content (FR-3.2)", () => {
    expect(validateLogContent("").ok).toBe(false);
    expect(validateLogContent("   \n\t ").ok).toBe(false);
    expect(validateLogContent(undefined).ok).toBe(false);
    expect(validateLogContent(42).ok).toBe(false);
  });

  it("accepts exactly the maximum length and rejects one more", () => {
    const atLimit = "x".repeat(LOG_CONTENT_MAX_LENGTH);
    expect(validateLogContent(atLimit).ok).toBe(true);
    expect(validateLogContent(`${atLimit}x`).ok).toBe(false);
  });

  it("counts the trimmed length, matching the database check", () => {
    const padded = ` ${"x".repeat(LOG_CONTENT_MAX_LENGTH)} `;
    expect(validateLogContent(padded).ok).toBe(true);
  });
});

describe("sortNewestFirst", () => {
  const entries = [
    { id: "a", created_at: "2026-09-09T06:10:00.000Z" },
    { id: "c", created_at: "2026-09-09T09:00:00.000Z" },
    { id: "b", created_at: "2026-09-09T07:30:00.000Z" },
  ];

  it("puts the newest entry first (FR-3.4)", () => {
    expect(sortNewestFirst(entries).map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("breaks ties deterministically instead of leaving the order to chance", () => {
    const sameInstant = [
      { id: "z", created_at: "2026-09-09T09:00:00.000Z" },
      { id: "a", created_at: "2026-09-09T09:00:00.000Z" },
    ];
    expect(sortNewestFirst(sameInstant).map((e) => e.id)).toEqual(["a", "z"]);
  });

  it("does not mutate the input array", () => {
    const input = [...entries];
    sortNewestFirst(input);
    expect(input.map((e) => e.id)).toEqual(["a", "c", "b"]);
  });
});

describe("isShiftLogOpen", () => {
  it("stays open while there is no handover, or one still in draft", () => {
    // FR-3.1: entries may be added until the handover is submitted.
    expect(isShiftLogOpen(null)).toBe(true);
    expect(isShiftLogOpen(undefined)).toBe(true);
    expect(isShiftLogOpen("draft")).toBe(true);
  });

  it("reopens when the supervisor asks for changes", () => {
    expect(isShiftLogOpen("changes_requested")).toBe(true);
  });

  it("freezes once the handover is submitted or approved (FR-3.5)", () => {
    expect(isShiftLogOpen("submitted")).toBe(false);
    expect(isShiftLogOpen("approved")).toBe(false);
  });
});
