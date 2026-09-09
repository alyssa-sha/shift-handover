// Route-group layouts do not add a URL segment, so `/` is the only key Next's
// generated LayoutProps offers here.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Shift Handover
          </h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Structured shift logs and reviewed handovers.
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
