import { SeverityBadge } from "@/components/SeverityBadge";
import { type LogEntryRow, sortNewestFirst } from "@/lib/log-entries";
import { formatDateTime } from "@/lib/shifts";

/**
 * Read-only shift log, newest first (FR-3.4).
 *
 * Used beside the handover content in the editor (FR-5.5) and in the
 * supervisor's review view (FR-7.2). Server-rendered, so timestamps are
 * formatted once and cannot drift between server and client.
 */
export function LogEntryList({
  entries,
  nameById,
  emptyMessage = "No log entries were recorded for this shift.",
}: {
  entries: readonly LogEntryRow[];
  nameById: Map<string, string>;
  emptyMessage?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-black/15 p-6 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {sortNewestFirst(entries).map((entry) => (
        <li
          key={entry.id}
          className="rounded-lg border border-black/10 p-3 dark:border-white/15"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SeverityBadge severity={entry.severity} />
            <p className="text-xs text-black/55 dark:text-white/55">
              {nameById.get(entry.author_id) ?? "Unknown user"} ·{" "}
              <time dateTime={entry.created_at}>
                {formatDateTime(entry.created_at)}
              </time>
            </p>
          </div>
          {/* User-authored text, rendered as text. */}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {entry.content}
          </p>
        </li>
      ))}
    </ul>
  );
}
