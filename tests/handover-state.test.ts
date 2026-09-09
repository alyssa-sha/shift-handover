import { describe, expect, it } from "vitest";

import {
  type Actor,
  HANDOVER_CONTENT_MAX_LENGTH,
  type HandoverSnapshot,
  canCreateHandover,
  canEditHandover,
  canReviewHandover,
  evaluateTransition,
  handoverStatusLabel,
  isPublished,
  validateHandoverContent,
} from "@/lib/handover-state";
import type { HandoverStatus } from "@/lib/types/database";

const author: Actor = { id: "op-1", role: "operator" };
const otherOperator: Actor = { id: "op-2", role: "operator" };
const supervisor: Actor = { id: "sup-1", role: "supervisor" };

function handover(status: HandoverStatus): HandoverSnapshot {
  return { status, authorId: author.id };
}

const CONTENT = "Two diversions overnight; stand 42 still blocked.";

const ALL_STATUSES: HandoverStatus[] = [
  "draft",
  "submitted",
  "changes_requested",
  "approved",
];

describe("legal transitions", () => {
  it("draft -> submitted when the author submits non-empty content", () => {
    const result = evaluateTransition({
      action: "submit",
      handover: handover("draft"),
      actor: author,
      content: CONTENT,
    });
    expect(result).toEqual({
      ok: true,
      nextStatus: "submitted",
      content: CONTENT,
    });
  });

  it("draft -> draft when the author saves without submitting", () => {
    const result = evaluateTransition({
      action: "save",
      handover: handover("draft"),
      actor: author,
      content: `  ${CONTENT}  `,
    });
    expect(result).toEqual({ ok: true, nextStatus: "draft", content: CONTENT });
  });

  it("submitted -> approved when a supervisor approves", () => {
    const result = evaluateTransition({
      action: "approve",
      handover: handover("submitted"),
      actor: supervisor,
    });
    expect(result).toEqual({ ok: true, nextStatus: "approved" });
  });

  it("submitted -> changes_requested with feedback", () => {
    const result = evaluateTransition({
      action: "request_changes",
      handover: handover("submitted"),
      actor: supervisor,
      feedback: "  Name the diverted flights.  ",
    });
    expect(result).toEqual({
      ok: true,
      nextStatus: "changes_requested",
      feedback: "Name the diverted flights.",
    });
  });

  it("changes_requested -> submitted when the author resubmits", () => {
    const result = evaluateTransition({
      action: "submit",
      handover: handover("changes_requested"),
      actor: author,
      content: CONTENT,
    });
    expect(result).toEqual({
      ok: true,
      nextStatus: "submitted",
      content: CONTENT,
    });
  });

  it("changes_requested -> draft when the author saves a revision", () => {
    // Forced by RLS: handovers_update_author has
    // with check (status in ('draft','submitted')), so an author-written row
    // cannot come back out still in changes_requested. The feedback survives
    // in handover_reviews, which is append-only (FR-7.5).
    const result = evaluateTransition({
      action: "save",
      handover: handover("changes_requested"),
      actor: author,
      content: CONTENT,
    });
    expect(result).toEqual({ ok: true, nextStatus: "draft", content: CONTENT });
  });
});

describe("illegal transitions - authorship", () => {
  it("refuses a submit by anyone but the author", () => {
    const result = evaluateTransition({
      action: "submit",
      handover: handover("draft"),
      actor: otherOperator,
      content: CONTENT,
    });
    expect(result).toMatchObject({ ok: false, reason: "not_author" });
  });

  it("refuses a supervisor writing handover content (FR-7.6)", () => {
    // A supervisor is not the author, so both author actions are closed to
    // them. Review is approve-or-return only.
    for (const action of ["save", "submit"] as const) {
      expect(
        evaluateTransition({
          action,
          handover: handover("submitted"),
          actor: supervisor,
          content: "Supervisor rewrite",
        }),
      ).toMatchObject({ ok: false, reason: "not_author" });
    }
  });
});

describe("illegal transitions - status", () => {
  it("refuses the author editing a submitted handover (FR-5.6)", () => {
    for (const action of ["save", "submit"] as const) {
      expect(
        evaluateTransition({
          action,
          handover: handover("submitted"),
          actor: author,
          content: CONTENT,
        }),
      ).toMatchObject({ ok: false, reason: "wrong_status" });
    }
  });

  it("refuses the author editing a published handover", () => {
    expect(
      evaluateTransition({
        action: "save",
        handover: handover("approved"),
        actor: author,
        content: CONTENT,
      }),
    ).toMatchObject({ ok: false, reason: "wrong_status" });
  });

  it("only allows review out of submitted, never any other status", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "submitted")) {
      expect(
        evaluateTransition({
          action: "approve",
          handover: handover(status),
          actor: supervisor,
        }),
      ).toMatchObject({ ok: false, reason: "wrong_status" });

      expect(
        evaluateTransition({
          action: "request_changes",
          handover: handover(status),
          actor: supervisor,
          feedback: "Please add the incident times.",
        }),
      ).toMatchObject({ ok: false, reason: "wrong_status" });
    }
  });

  it("refuses approving an already approved handover twice", () => {
    expect(
      evaluateTransition({
        action: "approve",
        handover: handover("approved"),
        actor: supervisor,
      }),
    ).toMatchObject({ ok: false, reason: "wrong_status" });
  });
});

describe("illegal transitions - role", () => {
  it("refuses an operator approving, including the author (FR-2.3)", () => {
    expect(
      evaluateTransition({
        action: "approve",
        handover: handover("submitted"),
        actor: author,
      }),
    ).toMatchObject({ ok: false, reason: "not_supervisor" });

    expect(
      evaluateTransition({
        action: "approve",
        handover: handover("submitted"),
        actor: otherOperator,
      }),
    ).toMatchObject({ ok: false, reason: "not_supervisor" });
  });

  it("refuses an operator requesting changes", () => {
    expect(
      evaluateTransition({
        action: "request_changes",
        handover: handover("submitted"),
        actor: otherOperator,
        feedback: "Not your call.",
      }),
    ).toMatchObject({ ok: false, reason: "not_supervisor" });
  });

  it("checks the role before the status, so the message never leaks state", () => {
    expect(
      evaluateTransition({
        action: "approve",
        handover: handover("draft"),
        actor: otherOperator,
      }),
    ).toMatchObject({ ok: false, reason: "not_supervisor" });
  });
});

describe("content rules (FR-5.4)", () => {
  it("refuses submitting empty or whitespace-only content", () => {
    for (const content of ["", "   ", "\n\t "]) {
      expect(
        evaluateTransition({
          action: "submit",
          handover: handover("draft"),
          actor: author,
          content,
        }),
      ).toMatchObject({ ok: false, reason: "empty_content" });
    }
  });

  it("refuses submitting with no content field at all", () => {
    expect(
      evaluateTransition({
        action: "submit",
        handover: handover("draft"),
        actor: author,
      }),
    ).toMatchObject({ ok: false, reason: "empty_content" });
  });

  it("allows saving an empty draft, which is not a submission", () => {
    expect(
      evaluateTransition({
        action: "save",
        handover: handover("draft"),
        actor: author,
        content: "   ",
      }),
    ).toEqual({ ok: true, nextStatus: "draft", content: "" });
  });

  it("accepts content at the 20000 character limit and refuses one more", () => {
    const atLimit = "x".repeat(HANDOVER_CONTENT_MAX_LENGTH);
    expect(
      evaluateTransition({
        action: "submit",
        handover: handover("draft"),
        actor: author,
        content: atLimit,
      }),
    ).toMatchObject({ ok: true, nextStatus: "submitted" });

    expect(
      evaluateTransition({
        action: "submit",
        handover: handover("draft"),
        actor: author,
        content: `${atLimit}x`,
      }),
    ).toMatchObject({ ok: false, reason: "content_too_long" });
  });

  it("validates content directly for callers that need it (AI draft, forms)", () => {
    expect(validateHandoverContent("", { allowEmpty: true })).toEqual({
      ok: true,
      content: "",
    });
    expect(validateHandoverContent("", { allowEmpty: false })).toMatchObject({
      ok: false,
      reason: "empty_content",
    });
  });
});

describe("feedback rules (FR-7.4)", () => {
  it("refuses requesting revision without feedback", () => {
    for (const feedback of [undefined, "", "   "]) {
      expect(
        evaluateTransition({
          action: "request_changes",
          handover: handover("submitted"),
          actor: supervisor,
          feedback,
        }),
      ).toMatchObject({ ok: false, reason: "empty_feedback" });
    }
  });

  it("does not require feedback to approve", () => {
    expect(
      evaluateTransition({
        action: "approve",
        handover: handover("submitted"),
        actor: supervisor,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("UI predicates", () => {
  it("offers handover creation only to an assigned operator with none yet", () => {
    // FR-5.2: creation is explicit, and one handover per shift (FR-5.1).
    expect(
      canCreateHandover({
        role: "operator",
        isAssigned: true,
        handoverExists: false,
      }),
    ).toBe(true);
    expect(
      canCreateHandover({
        role: "operator",
        isAssigned: true,
        handoverExists: true,
      }),
    ).toBe(false);
    expect(
      canCreateHandover({
        role: "operator",
        isAssigned: false,
        handoverExists: false,
      }),
    ).toBe(false);
    expect(
      canCreateHandover({
        role: "supervisor",
        isAssigned: true,
        handoverExists: false,
      }),
    ).toBe(false);
    expect(
      canCreateHandover({ role: null, isAssigned: true, handoverExists: false }),
    ).toBe(false);
  });

  it("lets only the author edit, and only in an editable status", () => {
    expect(canEditHandover(handover("draft"), author)).toBe(true);
    expect(canEditHandover(handover("changes_requested"), author)).toBe(true);
    expect(canEditHandover(handover("submitted"), author)).toBe(false);
    expect(canEditHandover(handover("approved"), author)).toBe(false);
    expect(canEditHandover(handover("draft"), otherOperator)).toBe(false);
    expect(canEditHandover(handover("draft"), supervisor)).toBe(false);
  });

  it("shows review controls to a supervisor on a submitted handover only", () => {
    expect(canReviewHandover(handover("submitted"), supervisor)).toBe(true);
    expect(canReviewHandover(handover("draft"), supervisor)).toBe(false);
    expect(canReviewHandover(handover("approved"), supervisor)).toBe(false);
    expect(canReviewHandover(handover("submitted"), author)).toBe(false);
  });

  it("labels approved as published and reports publication", () => {
    expect(handoverStatusLabel("approved")).toBe("Published");
    expect(handoverStatusLabel("changes_requested")).toBe("Changes requested");
    expect(handoverStatusLabel("submitted")).toBe("Submitted for review");
    expect(isPublished("approved")).toBe(true);
    expect(isPublished("submitted")).toBe(false);
  });
});
