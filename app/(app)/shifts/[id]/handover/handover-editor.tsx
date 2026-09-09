"use client";

import { useActionState } from "react";

import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { HANDOVER_CONTENT_MAX_LENGTH } from "@/lib/handover-state";

import {
  errorClass,
  inputClass,
  labelClass,
  noticeClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../../ui";
import { writeHandover } from "./actions";

/**
 * The handover content field (FR-5.4). The shift's log entries are rendered
 * beside it by the page, so the operator never navigates away (FR-5.5).
 *
 * Save and Submit share one form and one action; the pressed button's
 * name/value carries the intent.
 */
export function HandoverEditor({
  handoverId,
  shiftId,
  initialContent,
}: {
  handoverId: string;
  shiftId: string;
  initialContent: string;
}) {
  const [state, action, pending] = useActionState(
    writeHandover,
    IDLE_ACTION_STATE,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="handover_id" value={handoverId} />
      <input type="hidden" name="shift_id" value={shiftId} />

      <div>
        <label htmlFor="content" className={labelClass}>
          Handover content
        </label>
        <textarea
          id="content"
          name="content"
          rows={16}
          maxLength={HANDOVER_CONTENT_MAX_LENGTH}
          defaultValue={initialContent}
          placeholder="What the incoming shift needs to know: incidents first, then anything still open."
          className={`${inputClass} font-mono`}
        />
      </div>

      {state.status === "error" ? (
        <p role="alert" className={errorClass}>
          {state.message}
        </p>
      ) : null}

      {state.status === "success" && state.message ? (
        <p role="status" className={noticeClass}>
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          name="intent"
          value="submit"
          disabled={pending}
          className={primaryButtonClass}
        >
          {pending ? "Working…" : "Submit for review"}
        </button>

        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className={secondaryButtonClass}
        >
          Save draft
        </button>

        {/*
          FR-6.1 lands in the AI milestone. The button is here so the layout is
          the final one, and it is deliberately inert: it is wired to nothing,
          and submits nothing.
        */}
        <button
          type="button"
          disabled
          title="Draft with AI arrives with the AI milestone (FR-6)."
          className={secondaryButtonClass}
        >
          Draft with AI
        </button>
      </div>

      <p className="text-xs text-black/50 dark:text-white/50">
        Submitting makes the handover read-only until a supervisor approves it or
        asks for changes.
      </p>
    </form>
  );
}
