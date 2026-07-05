import { redirect } from "next/navigation";
import { ScheduleDashboard } from "@/components/admin/schedule/schedule-dashboard";
import { AppPlaceholderPage } from "@/components/app/app-placeholder-page";
import {
  buildScheduleCreatorViewModel,
  parseValidationIssues,
} from "@/lib/admin/schedule";
import { getDefaultPeriodId } from "@/lib/admin/availability";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type AdminSchedulePageProps = {
  searchParams: Promise<{ period?: string }>;
};

export default async function AdminSchedulePage({ searchParams }: AdminSchedulePageProps) {
  const params = await searchParams;
  const supabase = await getSupabaseServerClient();

  const { data: periods, error: periodsError } = await supabase
    .from("schedule_periods")
    .select(
      "id, name, start_date, end_date, availability_deadline, status, published_at, created_by, created_at, updated_at",
    )
    .order("start_date", { ascending: true });

  if (periodsError) {
    console.error("schedule periods failed", periodsError);

    return (
      <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        Schedule data could not be loaded. Please refresh and try again.
      </section>
    );
  }

  if (!periods || periods.length === 0) {
    return (
      <AppPlaceholderPage
        eyebrow="Schedule"
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
        eyebrow="Schedule"
        title="No schedule period yet"
        message="No schedule period has been created yet."
      />
    );
  }

  if (params.period !== selectedPeriodId) {
    redirect(`/admin/schedule?period=${selectedPeriodId}`);
  }

  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId);

  if (!selectedPeriod) {
    redirect(`/admin/schedule?period=${defaultPeriodId}`);
  }

  const [
    { data: activeStaff, error: staffError },
    { data: submissions, error: submissionsError },
    { data: contracts, error: contractsError },
    { data: trainingRows, error: trainingError },
    { data: budgets, error: budgetsError },
    { data: shifts, error: shiftsError },
    { data: generationRuns, error: runsError },
    coverageRowsResult,
    contractRowsResult,
    budgetRowsResult,
    validationResult,
  ] = await Promise.all([
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
      .from("employment_contracts")
      .select(
        "id, staff_id, start_date, end_date, min_shifts_per_week, target_shifts_per_week, max_shifts_per_week, standard_shift_hours, notes, created_at, updated_at",
      ),
    supabase
      .from("staff_training_status")
      .select(
        "staff_id, phase, training_started_on, target_completion_on, phase_started_on, fully_trained_on, updated_by, notes, updated_at",
      ),
    supabase
      .from("schedule_budgets")
      .select(
        "id, period_id, scope, work_role, staff_id, max_shifts, weekly_reference, notes, created_at, updated_at",
      )
      .eq("period_id", selectedPeriod.id),
    supabase
      .from("shifts")
      .select(
        "id, period_id, shift_date, shift_type, start_time, end_time, required_count, is_optional, notes, created_at, updated_at",
      )
      .eq("period_id", selectedPeriod.id)
      .order("shift_date", { ascending: true }),
    supabase
      .from("schedule_generation_runs")
      .select(
        "id, period_id, status, initiated_by, started_at, completed_at, failed_at, failure_message, current_stage, metadata, created_at, updated_at",
      )
      .eq("period_id", selectedPeriod.id)
      .order("created_at", { ascending: false }),
    supabase.from("daily_coverage_status").select("*").eq("period_id", selectedPeriod.id),
    supabase.from("contract_period_progress").select("*").eq("period_id", selectedPeriod.id),
    supabase.from("period_budget_usage").select("*").eq("period_id", selectedPeriod.id),
    supabase.rpc("validate_schedule_period", { p_period_id: selectedPeriod.id }),
  ]);

  if (
    staffError ||
    submissionsError ||
    contractsError ||
    trainingError ||
    budgetsError ||
    shiftsError ||
    runsError
  ) {
    console.error("schedule page fetch failed", {
      staffError,
      submissionsError,
      contractsError,
      trainingError,
      budgetsError,
      shiftsError,
      runsError,
    });

    return (
      <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        Schedule data could not be loaded. Please refresh and try again.
      </section>
    );
  }

  const shiftIds = (shifts ?? []).map((shift) => shift.id);
  const { data: assignments, error: assignmentsError } = shiftIds.length
    ? await supabase
        .from("shift_assignments")
        .select(
          "id, shift_id, staff_id, status, lifecycle, generation_run_id, assigned_by, assigned_at, manager_note, created_at, updated_at",
        )
        .in("shift_id", shiftIds)
    : { data: [], error: null };

  if (assignmentsError) {
    console.error("schedule assignments fetch failed", assignmentsError);

    return (
      <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        Schedule assignments could not be loaded. Please refresh and try again.
      </section>
    );
  }

  if (coverageRowsResult.error) {
    console.error("daily coverage status unavailable", coverageRowsResult.error);
  }

  if (contractRowsResult.error) {
    console.error("contract period progress unavailable", contractRowsResult.error);
  }

  if (budgetRowsResult.error) {
    console.error("period budget usage unavailable", budgetRowsResult.error);
  }

  if (validationResult.error) {
    console.error("validate_schedule_period unavailable", validationResult.error);
  }

  const model = buildScheduleCreatorViewModel({
    selectedPeriod,
    activeStaff: activeStaff ?? [],
    submissions: submissions ?? [],
    contracts: contracts ?? [],
    trainingRows: trainingRows ?? [],
    budgets: budgets ?? [],
    shifts: shifts ?? [],
    assignments: assignments ?? [],
    generationRuns: generationRuns ?? [],
    validationIssues: parseValidationIssues((validationResult.data ?? null) as never),
    coverageRows: coverageRowsResult.data ?? [],
    contractRows: contractRowsResult.data ?? [],
    budgetRows: budgetRowsResult.data ?? [],
  });

  return (
    <ScheduleDashboard
      key={selectedPeriod.id}
      periods={periods}
      selectedPeriod={selectedPeriod}
      model={model}
    />
  );
}
