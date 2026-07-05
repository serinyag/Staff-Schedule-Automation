import Link from "next/link";
import { StaffDashboard } from "@/components/admin/staff/staff-dashboard";
import {
  buildStaffAdminRecords,
  getProfileLabel,
  summarizeStaff,
} from "@/lib/admin/staff";
import { requireManagerOrAdmin } from "@/lib/authenticated-app";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminStaffPage() {
  const context = await requireManagerOrAdmin();
  const supabase = await getSupabaseServerClient();

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
    <div className="flex flex-col gap-6">
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
              Signed in as {getProfileLabel(context.profile)}
            </span>
            <Link
              href="/availability"
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              My availability
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
  );
}
