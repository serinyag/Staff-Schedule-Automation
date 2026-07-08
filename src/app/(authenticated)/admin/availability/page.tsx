import { redirect } from "next/navigation";
import { AvailabilityDashboard } from "@/components/admin/availability/availability-dashboard";
import { AppPlaceholderPage } from "@/components/app/app-placeholder-page";
import {
  buildTeamAvailabilityViewModel,
  getDefaultPeriodId,
} from "@/lib/admin/availability";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type AdminAvailabilityPageProps = {
  searchParams: Promise<{ period?: string }>;
};

export default async function AdminAvailabilityPage({
  searchParams,
}: AdminAvailabilityPageProps) {
  const params = await searchParams;
  const supabase = await getSupabaseServerClient();

  const { data: periods, error: periodsError } = await supabase
    .from("schedule_periods")
    .select(
      "id, name, start_date, end_date, availability_deadline, monthly_staff_budget_eur, status, published_at, created_by, created_at, updated_at",
    )
    .order("start_date", { ascending: true });

  if (periodsError) {
    console.error("team availability periods failed", periodsError);

    return (
      <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        Team availability could not be loaded. Please refresh and try again.
      </section>
    );
  }

  if (!periods || periods.length === 0) {
    return (
      <AppPlaceholderPage
        eyebrow="Team Availability"
        title="No schedule period yet"
        message="No schedule period has been created yet."
      />
    );
  }

  const defaultPeriodId = getDefaultPeriodId(periods);
  const selectedPeriodId = periods.some((period) => period.id === params.period)
    ? params.period!
    : defaultPeriodId;

  if (!selectedPeriodId) {
    return (
      <AppPlaceholderPage
        eyebrow="Team Availability"
        title="No schedule period yet"
        message="No schedule period has been created yet."
      />
    );
  }

  if (params.period !== selectedPeriodId) {
    redirect(`/admin/availability?period=${selectedPeriodId}`);
  }

  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId);

  if (!selectedPeriod) {
    redirect(`/admin/availability?period=${defaultPeriodId}`);
  }

  const [{ data: activeStaff, error: staffError }, { data: submissions, error: submissionsError }, { data: unavailableStreaks, error: streaksError }, { data: settings, error: settingsError }] =
    await Promise.all([
      supabase
        .from("staff_members")
        .select(
          "id, profile_id, full_name, work_role, scheduling_rule_role, hourly_rate, is_active, is_wildcard_fill_in, is_initial_training_mentor, default_weekly_budget_shifts, created_at, updated_at",
        )
        .eq("is_active", true)
        .order("full_name"),
      supabase
        .from("availability_submissions")
        .select(
          "id, period_id, staff_id, status, willing_to_work_above_target, max_extra_shifts_for_period, submitted_at, notes, created_at, updated_at",
        )
        .eq("period_id", selectedPeriod.id),
      supabase
        .from("availability_unavailable_streaks")
        .select("staff_id, period_id, streak_start, streak_end, streak_days")
        .eq("period_id", selectedPeriod.id),
      supabase
        .from("scheduling_settings")
        .select(
          "singleton, holiday_streak_days, default_soft_max_consecutive_days, default_hard_max_consecutive_days, min_days_off_per_week_high_commitment, high_commitment_threshold_shifts_per_week, block_evening_to_next_morning, initial_mentor_shift_count, min_morning_coverage, min_evening_coverage, updated_at",
        )
        .eq("singleton", true)
        .maybeSingle(),
    ]);

  if (staffError || submissionsError || streaksError || settingsError) {
    console.error("team availability fetch failed", {
      staffError,
      submissionsError,
      streaksError,
      settingsError,
    });

    return (
      <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        Team availability could not be loaded. Please refresh and try again.
      </section>
    );
  }

  const submissionIds = (submissions ?? []).map((submission) => submission.id);
  const { data: availabilityDays, error: daysError } = submissionIds.length
    ? await supabase
        .from("availability_days")
        .select("id, submission_id, available_date, morning, day, evening, created_at, updated_at")
        .in("submission_id", submissionIds)
    : { data: [], error: null };

  if (daysError) {
    console.error("team availability days failed", daysError);

    return (
      <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        Team availability could not be loaded. Please refresh and try again.
      </section>
    );
  }

  const model = buildTeamAvailabilityViewModel({
    activeStaff: activeStaff ?? [],
    submissions: submissions ?? [],
    availabilityDays: availabilityDays ?? [],
    unavailableStreaks: unavailableStreaks ?? [],
    settings: settings ?? null,
  });

  return (
    <AvailabilityDashboard
      key={selectedPeriod.id}
      periods={periods}
      selectedPeriod={selectedPeriod}
      model={model}
    />
  );
}
