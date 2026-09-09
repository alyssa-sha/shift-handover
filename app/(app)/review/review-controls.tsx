"use client";

import { useActionState } from "react";

import { IDLE_ACTION_STATE } from "@/lib/action-state";

import {
  errorClass,
  inputClass,
  labelClass,
  noticeClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../ui";
import { approveHandover, requestRevision } from "./actions";

/**
 * Approve or return, and nothing else: there is no content field here, because
 * a supervisor may not edit a handover (FR-7.6).
 */
export function ReviewControls({ handoverId }: { handoverId: string }) {
  const [approveState, approve, approving] = useActionState(
    approveHandover,
    IDLE_ACTION_STATE,
  );
  const [revisionState, sendBack, sending] = useActionState(
    requestRevision,
    IDLE_ACTION_STATE,
  );

  return (
    <div className="space-y-4">
      <form action={approve}>
        <input type="hidden" name="handover_id" value={handoverId} />
        <button
          type="submit"
          disabled={approving || sending}
          className={primaryButtonClass}
        >
          {approving ? "Approving…" : "Approve and publish"}
        </button>
        {approveState.status === "error" ? (
          <p role="alert" className={`mt-2 ${errorClass}`}>
            {approveState.message}
          </p>
        ) : null}
      </form>

      <form action={sendBack} className="space-y-2">
        <input type="hidden" name="handover_id" value={handoverId} />

        <label htmlFor={`feedback-${handoverId}`} className={labelClass}>
          Feedback for the operator
        </label>
        <textarea
          id={`feedback-${handoverId}`}
          name="feedback"
          rows={3}
          required
          placeholder="Name the two diverted flights and say what is still open on stand 42."
          className={inputClass}
        />

        {revisionState.status === "error" ? (
          <p role="alert" className={errorClass}>
            {revisionState.message}
          </p>
        ) : null}

        {revisionState.status === "success" && revisionState.message ? (
          <p role="status" className={noticeClass}>
            {revisionState.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={approving || sending}
          className={secondaryButtonClass}
        >
          {sending ? "Sending…" : "Request revision"}
        </button>
        <p className="text-xs text-black/50 dark:text-white/50">
          Feedback is required, and every round is kept.
        </p>
      </form>
    </div>
  );
}
