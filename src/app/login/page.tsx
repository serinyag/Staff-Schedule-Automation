import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/login-form";
import { normalizeNextPath } from "@/lib/authenticated-app";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(normalizeNextPath(params.next));
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(188,212,255,0.45),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-5 bg-slate-950 px-8 py-10 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-200">
              WNC Staff Scheduling
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Staff sign in
            </h1>
            <p className="max-w-md text-sm leading-7 text-slate-300 sm:text-base">
              Sign in with your existing account to submit your availability, view your schedule,
              and, if your role allows it, open the management tools.
            </p>
          </div>

          <div className="px-6 py-8 sm:px-8 sm:py-10">
            <div className="mb-6 space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Sign in</h2>
              <p className="text-sm leading-6 text-slate-600">
                Staff, managers, and admins all use the same sign-in.
              </p>
              <p className="text-sm leading-6 text-slate-600">
                Admin and manager accounts are taken to the admin area automatically after login.
              </p>
            </div>

            <LoginForm nextPath={normalizeNextPath(params.next)} />
          </div>
        </section>
      </div>
    </main>
  );
}
