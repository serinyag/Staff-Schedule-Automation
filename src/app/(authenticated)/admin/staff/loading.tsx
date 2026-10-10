function SummaryCardSkeleton() {
  return <div className="h-28 animate-pulse rounded-xl bg-slate-200/80" />;
}

export default function AdminStaffLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="h-4 w-40 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-12 w-80 max-w-full animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-4 w-full max-w-2xl animate-pulse rounded-full bg-slate-200" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <SummaryCardSkeleton key={index} />
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="h-12 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl bg-slate-200/80" />
          ))}
        </div>
      </div>
    </div>
  );
}
