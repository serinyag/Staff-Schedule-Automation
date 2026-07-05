function SummaryCardSkeleton() {
  return <div className="h-28 animate-pulse rounded-[1.6rem] bg-slate-200/80" />;
}

export default function AdminAvailabilityLoading() {
  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <div className="h-4 w-44 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-12 w-72 max-w-full animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-4 w-full max-w-2xl animate-pulse rounded-full bg-slate-200" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SummaryCardSkeleton key={index} />
        ))}
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <div className="h-4 w-40 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-[1.5rem] bg-slate-200/80" />
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <div className="h-12 w-72 animate-pulse rounded-2xl bg-slate-200" />
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-64 animate-pulse rounded-[1.75rem] bg-slate-200/80" />
          ))}
        </div>
      </section>
    </div>
  );
}
