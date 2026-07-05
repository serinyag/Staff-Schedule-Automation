import Link from "next/link";

type UnauthorizedPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

function getMessage(reason: string | undefined) {
  if (reason === "inactive") {
    return "Your profile is inactive, so this portal is currently unavailable for your account.";
  }

  return "This area is only available to manager or admin profiles.";
}

export default async function UnauthorizedPage({ searchParams }: UnauthorizedPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(188,212,255,0.45),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <section className="w-full rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">
            Access restricted
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            You don&apos;t have permission to open this area.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
            {getMessage(params.reason)}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/availability"
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Go to my availability
            </Link>
            <Link
              href="/login?next=/admin/staff"
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Sign in with a different account
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
