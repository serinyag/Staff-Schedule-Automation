function ScheduleBlockSkeleton({ height }: { height: string }) {
  return <div className={`${height} animate-pulse rounded-[1.7rem] bg-slate-200/80`} />;
}

export default function AdminScheduleLoading() {
  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <div className="h-4 w-32 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-12 w-80 max-w-full animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-4 w-full max-w-3xl animate-pulse rounded-full bg-slate-200" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <ScheduleBlockSkeleton height="h-80" />
        <ScheduleBlockSkeleton height="h-80" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <ScheduleBlockSkeleton key={index} height="h-32" />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <ScheduleBlockSkeleton height="h-96" />
        <ScheduleBlockSkeleton height="h-96" />
      </section>
    </div>
  );
}
