"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  DEFAULT_SEVERITY,
  LOG_CONTENT_MAX_LENGTH,
  SEVERITIES,
  severityLabel,
} from "@/lib/log-entries";
import { IDLE_ACTION_STATE } from "@/lib/action-state";

import {
  errorClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "../../ui";
import { createLogEntry } from "./actions";

/** The entry form on the shift detail page (FR-3.1, FR-3.2). */
export function LogEntryForm({ shiftId }: { shiftId: string }) {
  const [state, action, pending] = useActionState(
    createLogEntry,
    IDLE_ACTION_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="shift_id" value={shiftId} />

      <div>
        <label htmlFor="severity" className={labelClass}>
          Severity
        </label>
        <select
          id="severity"
          name="severity"
          defaultValue={DEFAULT_SEVERITY}
          className={inputClass}
        >
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severityLabel(severity)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="content" className={labelClass}>
          What happened
        </label>
        <textarea
          id="content"
          name="content"
          rows={3}
          required
          maxLength={LOG_CONTENT_MAX_LENGTH}
          placeholder="Stand 42 blocked by a disabled tug; ops notified."
          className={inputClass}
        />
      </div>

      {state.status === "error" ? (
        <p role="alert" className={errorClass}>
          {state.message}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Adding…" : "Add entry"}
      </button>
    </form>
  );
}
