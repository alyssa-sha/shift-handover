"use client";

import { useActionState, useState } from "react";

import { SeverityBadge } from "@/components/SeverityBadge";
import { type ActionState, IDLE_ACTION_STATE } from "@/lib/action-state";
import {
  LOG_CONTENT_MAX_LENGTH,
  SEVERITIES,
  type LogEntryRow,
  severityLabel,
} from "@/lib/log-entries";

import {
  dangerButtonClass,
  errorClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  userTextClass,
} from "../../ui";
import { deleteLogEntry, updateLogEntry } from "./actions";

export type LogEntryItemProps = {
  entry: LogEntryRow;
  authorName: string;
  /** Formatted on the server, so the client never re-formats and mismatches. */
  createdAtLabel: string;
  /** True only for the author, while the shift's handover is still open. */
  canManage: boolean;
};

/**
 * One log entry: severity badge, author and timestamp (FR-3.4), with edit and
 * delete for the author until the handover is submitted (FR-3.5).
 */
export function LogEntryItem({
  entry,
  authorName,
  createdAtLabel,
  canManage,
}: LogEntryItemProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Wrapped so a successful save closes the editor; the action itself stays a
  // plain (state, formData) Server Action.
  const [updateState, update, updating] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await updateLogEntry(previous, formData);
      if (result.status === "success") setEditing(false);
      return result;
    },
    IDLE_ACTION_STATE,
  );

  const [deleteState, remove, removing] = useActionState(
    deleteLogEntry,
    IDLE_ACTION_STATE,
  );

  return (
    <li className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeverityBadge severity={entry.severity} />
        <p className="text-xs text-black/55 dark:text-white/55">
          {authorName} · <time dateTime={entry.created_at}>{createdAtLabel}</time>
        </p>
      </div>

      {editing ? (
        <form action={update} className="mt-3 space-y-3">
          <input type="hidden" name="entry_id" value={entry.id} />
          <input type="hidden" name="shift_id" value={entry.shift_id} />

          <label className="sr-only" htmlFor={`severity-${entry.id}`}>
            Severity
          </label>
          <select
            id={`severity-${entry.id}`}
            name="severity"
            defaultValue={entry.severity}
            className={inputClass}
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severityLabel(severity)}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor={`content-${entry.id}`}>
            Entry
          </label>
          <textarea
            id={`content-${entry.id}`}
            name="content"
            rows={3}
            required
            maxLength={LOG_CONTENT_MAX_LENGTH}
            defaultValue={entry.content}
            className={inputClass}
          />

          {updateState.status === "error" ? (
            <p role="alert" className={errorClass}>
              {updateState.message}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={updating}
              className={primaryButtonClass}
            >
              {updating ? "Saving…" : "Save entry"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className={`mt-3 ${userTextClass}`}>{entry.content}</p>
      )}

      {canManage && !editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={secondaryButtonClass}
          >
            Edit
          </button>

          {confirmingDelete ? (
            <form action={remove} className="flex items-center gap-2">
              <input type="hidden" name="entry_id" value={entry.id} />
              <input type="hidden" name="shift_id" value={entry.shift_id} />
              <button
                type="submit"
                disabled={removing}
                className={dangerButtonClass}
              >
                {removing ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className={secondaryButtonClass}
              >
                Keep
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className={dangerButtonClass}
            >
              Delete
            </button>
          )}
        </div>
      ) : null}

      {deleteState.status === "error" ? (
        <p role="alert" className={`mt-3 ${errorClass}`}>
          {deleteState.message}
        </p>
      ) : null}
    </li>
  );
}
