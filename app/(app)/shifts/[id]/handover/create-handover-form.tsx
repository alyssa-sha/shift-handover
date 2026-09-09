"use client";

import { useActionState } from "react";

import { IDLE_ACTION_STATE } from "@/lib/action-state";

import { errorClass, primaryButtonClass } from "../../../ui";
import { createHandover } from "./actions";

/**
 * FR-5.2: the handover is created by an explicit click, never automatically by
 * opening the page.
 */
export function CreateHandoverForm({ shiftId }: { shiftId: string }) {
  const [state, action, pending] = useActionState(
    createHandover,
    IDLE_ACTION_STATE,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="shift_id" value={shiftId} />

      {state.status === "error" ? (
        <p role="alert" className={errorClass}>
          {state.message}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Creating…" : "Create handover"}
      </button>
    </form>
  );
}
