import { type SlotStatus, slotStatusLabel } from "@/lib/shifts";

/**
 * Handover status on a calendar slot and on the shift detail page (FR-4.3).
 * Text label plus colour, for the same reason as SeverityBadge.
 */
const STATUS_CLASS: Record<SlotStatus, string> = {
  unknown: "border-black/15 text-black/45 dark:border-white/20 dark:text-white/45",
  none: "border-black/15 text-black/60 dark:border-white/20 dark:text-white/60",
  draft: "border-slate-500/40 bg-slate-500/10 text-slate-800 dark:text-slate-200",
  submitted: "border-amber-600/50 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  changes_requested:
    "border-orange-600/50 bg-orange-500/15 text-orange-900 dark:text-orange-200",
  approved:
    "border-emerald-600/50 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200",
};

export function SlotStatusBadge({ status }: { status: SlotStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASS[status]}`}
    >
      {slotStatusLabel(status)}
    </span>
  );
}
