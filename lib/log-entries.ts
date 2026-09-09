/**
 * Pure log-entry logic (FR-3).
 *
 * Severity vocabulary, content validation and ordering live here so the Server
 * Actions, the entry form and the badge all agree, and so the rules can be
 * tested without a database. The database enforces the same bounds
 * (log_entries_content_length in 0001_init.sql); this is the app-level half.
 */

import type { LogEntry, LogSeverity } from "@/lib/types/database";

/** Ascending urgency (decision D1). Index doubles as the sort rank. */
export const SEVERITIES = ["info", "warning", "critical"] as const;

export const SEVERITY_LABEL: Record<LogSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

export const DEFAULT_SEVERITY: LogSeverity = "info";

export const LOG_CONTENT_MIN_LENGTH = 1;
export const LOG_CONTENT_MAX_LENGTH = 2000;

/** Narrow untrusted form input to a severity, or null if it is not one. */
export function parseSeverity(value: unknown): LogSeverity | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return (SEVERITIES as readonly string[]).includes(normalised)
    ? (normalised as LogSeverity)
    : null;
}

export function severityLabel(severity: LogSeverity): string {
  return SEVERITY_LABEL[severity];
}

/** Highest severity first; ties keep their input order. */
export function severityRank(severity: LogSeverity): number {
  return SEVERITIES.indexOf(severity);
}

export type ContentValidation =
  | { ok: true; content: string }
  | { ok: false; message: string };

/**
 * FR-3.2: non-empty, 1-2000 characters. Whitespace-only content is empty, so
 * the trimmed value is what gets stored.
 */
export function validateLogContent(value: unknown): ContentValidation {
  const content = typeof value === "string" ? value.trim() : "";

  if (content.length < LOG_CONTENT_MIN_LENGTH) {
    return { ok: false, message: "Write something before saving the entry." };
  }
  if (content.length > LOG_CONTENT_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep the entry to ${LOG_CONTENT_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, content };
}

/** The log-entry columns the list and the handover editor need. */
export type LogEntryRow = Pick<
  LogEntry,
  "id" | "shift_id" | "author_id" | "severity" | "content" | "created_at"
>;

/** FR-3.4: newest first. Stable on equal timestamps, so a list never jitters. */
export function sortNewestFirst<T extends Pick<LogEntryRow, "id" | "created_at">>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
      a.id.localeCompare(b.id),
  );
}

/**
 * FR-3.1 / FR-3.5: entries are mutable only while the shift's handover has not
 * been submitted or approved. Mirrors `shift_handover_open()` in the migration,
 * which is what actually enforces it.
 */
export function isShiftLogOpen(
  handoverStatus: string | null | undefined,
): boolean {
  return handoverStatus !== "submitted" && handoverStatus !== "approved";
}
