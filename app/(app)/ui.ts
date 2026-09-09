/** Shared Tailwind class strings for the signed-in app shell. */

export const cardClass =
  "rounded-lg border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5";

export const labelClass = "block text-sm font-medium";

export const inputClass =
  "mt-1 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm " +
  "outline-none focus:border-black/40 dark:border-white/20 dark:bg-black/20 " +
  "dark:focus:border-white/50";

export const primaryButtonClass =
  "rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background " +
  "transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButtonClass =
  "rounded-md border border-black/15 px-3 py-2 text-sm transition-colors " +
  "hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 " +
  "dark:border-white/20 dark:hover:bg-white/10";

export const dangerButtonClass =
  "rounded-md border border-red-600/40 px-3 py-2 text-sm text-red-700 " +
  "transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed " +
  "disabled:opacity-50 dark:text-red-300";

export const errorClass =
  "rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 " +
  "dark:text-red-300";

export const noticeClass =
  "rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 text-sm " +
  "text-black/70 dark:border-white/15 dark:bg-white/5 dark:text-white/70";

export const linkClass = "font-medium underline underline-offset-4";

/**
 * User-authored text is rendered as text, never as HTML (CLAUDE.md security
 * rules). `whitespace-pre-wrap` keeps the operator's line breaks without
 * interpreting anything in the content.
 */
export const userTextClass = "whitespace-pre-wrap break-words text-sm";
