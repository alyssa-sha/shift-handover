import { severityLabel } from "@/lib/log-entries";
import type { LogSeverity } from "@/lib/types/database";

/**
 * FR-3.3: severity is visually distinct, and colour is never the only signal.
 * Every badge carries its text label, so the list still reads correctly in
 * greyscale, for a colour-blind user, or through a screen reader.
 */
const SEVERITY_CLASS: Record<LogSeverity, string> = {
  info: "border-sky-600/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  warning:
    "border-amber-600/50 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  critical:
    "border-red-600/60 bg-red-500/15 text-red-800 dark:text-red-200 font-semibold",
};

/** A short glyph, so severity survives a black-and-white print too. */
const SEVERITY_GLYPH: Record<LogSeverity, string> = {
  info: "i",
  warning: "!",
  critical: "!!",
};

export function SeverityBadge({ severity }: { severity: LogSeverity }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${SEVERITY_CLASS[severity]}`}
    >
      <span aria-hidden="true" className="font-mono">
        {SEVERITY_GLYPH[severity]}
      </span>
      {severityLabel(severity)}
    </span>
  );
}
