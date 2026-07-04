import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffDashboard } from "@/components/admin/staff/staff-dashboard";
import {
  buildStaffAdminRecords,
  getProfileLabel,
  isManagerOrAdmin,
  summarizeStaff,
} from "@/lib/admin/staff";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminStaffPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/staff");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, app_role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    redirect("/unauthorized");
  }

  if (!profile.is_active) {
    redirect("/unauthorized?reason=inactive");
  }

  if (!isManagerOrAdmin(profile.app_role)) {
    redirect("/unauthorized?reason=role");
  }

  const [{ data: staffRows, error: staffError }, { data: contractRows, error: contractError }, { data: trainingRows, error: trainingError }] =
    await Promise.all([
      supabase.from("staff_members").select("*").order("full_name"),
      supabase.from("employment_contracts").select("*"),
      supabase.from("staff_training_status").select("*"),
    ]);

  const loadError = staffError || contractError || trainingError;
  const records = loadError
    ? []
    : buildStaffAdminRecords(staffRows ?? [], contractRows ?? [], trainingRows ?? []);
  const summary = summarizeStaff(records);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(188,212,255,0.45),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">
                Manager Admin Portal
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-balance text-slate-950 sm:text-5xl">
                Staff Management
              </h1>
              <p className="text-sm leading-7 text-slate-600 sm:text-base">
                Manage staff roles, scheduling rules, contracts, training status, and active
                employment status.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
                Signed in as {getProfileLabel(profile)}
              </span>
              <Link
                href="/"
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Staff availability form
              </Link>
            </div>
          </div>
        </section>

        {loadError ? (
          <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
            We could not load the staff administration data from Supabase.{" "}
            {loadError.message || "Please check the connected tables and RLS policies, then try again."}
          </section>
        ) : (
          <StaffDashboard records={records} summary={summary} />
        )}
      </div>
    </main>
  );
}
