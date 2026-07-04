function SummaryCardSkeleton() {
  return <div className="h-28 animate-pulse rounded-[1.5rem] bg-slate-200/80" />;
}

export default function AdminStaffLoading() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(188,212,255,0.45),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <div className="h-4 w-40 animate-pulse rounded-full bg-slate-200" />
          <div className="mt-4 h-12 w-80 max-w-full animate-pulse rounded-full bg-slate-200" />
          <div className="mt-4 h-4 w-full max-w-2xl animate-pulse rounded-full bg-slate-200" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <SummaryCardSkeleton key={index} />
          ))}
        </div>

        <div className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <div className="h-12 animate-pulse rounded-2xl bg-slate-200" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-[1.5rem] bg-slate-200/80" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
