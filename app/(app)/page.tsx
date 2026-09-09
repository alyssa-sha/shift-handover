import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calendar · Shift Handover",
};

export default function CalendarPage() {
  return (
    <section className="rounded-lg border border-dashed border-black/15 p-8 text-center dark:border-white/20">
      <h1 className="text-lg font-semibold tracking-tight">Shift calendar</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-black/60 dark:text-white/60">
        The week view of shift slots lands in the next milestone. You are signed
        in, so authentication and route protection are working.
      </p>
    </section>
  );
}
