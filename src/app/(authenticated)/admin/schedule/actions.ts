"use server";

import { revalidatePath } from "next/cache";
import type {
  ScheduleBudgetMutationState,
  ScheduleMutationState,
} from "@/app/(authenticated)/admin/schedule/action-state";
import { buildReadinessChecks, buildScheduleBudgetSummary } from "@/lib/admin/schedule";
import { startScheduleGenerationOrchestration } from "@/lib/admin/schedule-orchestration";
import { isManagerOrAdmin } from "@/lib/admin/staff";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AvailabilitySubmissionRow,
  EmploymentContractRow,
  SchedulePeriodRow,
  ShiftRow,
  StaffMemberRow,
  StaffTrainingStatusRow,
} from "@/lib/supabase/types";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseOptionalNonNegativeCurrency(value: string, fieldLabel: string) {
  if (!value.trim()) {
    return { value: null, error: null };
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, error: `${fieldLabel} must be 0 or greater.` };
  }

  return { value: parsed, error: null };
}

async function getAuthorizedManagerContext() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null, message: "Your session expired. Sign in again and retry." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, app_role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active || !isManagerOrAdmin(profile.app_role)) {
    return { supabase, user: null, message: "You do not have permission to manage schedules." };
  }

  return { supabase, user, message: null };
}

async function loadReadinessInputs(supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>, periodId: string) {
  const [{ data: period }, { data: activeStaff }, { data: submissions }, { data: contracts }, { data: trainingRows }, { data: shifts }] =
    await Promise.all([
      supabase
        .from("schedule_periods")
        .select(
          "id, name, start_date, end_date, availability_deadline, monthly_staff_budget_eur, status, published_at, created_by, created_at, updated_at",
        )
        .eq("id", periodId)
        .maybeSingle(),
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
        .eq("period_id", periodId),
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
        .from("shifts")
        .select(
          "id, period_id, shift_date, shift_type, start_time, end_time, required_count, is_optional, notes, created_at, updated_at",
        )
        .eq("period_id", periodId),
    ]);

  if (!period) {
    return { period: null, readiness: null };
  }

  const budget = buildScheduleBudgetSummary({
    selectedPeriod: period as SchedulePeriodRow,
    activeStaff: (activeStaff ?? []) as StaffMemberRow[],
    contracts: (contracts ?? []) as EmploymentContractRow[],
    shifts: (shifts ?? []) as ShiftRow[],
    assignments: [],
    activeLifecycle: null,
  });

  return {
    period,
    budget,
    readiness: buildReadinessChecks({
      selectedPeriod: period as SchedulePeriodRow,
      activeStaff: (activeStaff ?? []) as StaffMemberRow[],
      submissions: (submissions ?? []) as AvailabilitySubmissionRow[],
      contracts: (contracts ?? []) as EmploymentContractRow[],
      trainingRows: (trainingRows ?? []) as StaffTrainingStatusRow[],
      budget,
      shifts: (shifts ?? []) as ShiftRow[],
    }),
  };
}

function mapScheduleRpcError(error: { code?: string; message: string }) {
  if (error.code === "42501") {
    return "You do not have permission to manage schedules.";
  }

  if (error.code === "P0002") {
    return "The selected schedule period could not be found.";
  }

  if (error.code === "23505") {
    return "A generation run is already active for this period.";
  }

  return error.message || "We couldn't complete that schedule action right now.";
}

async function markScheduleGenerationRunFailed({
  supabase,
  runId,
  periodId,
  failureMessage,
}: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  runId: string;
  periodId: string;
  failureMessage: string;
}) {
  const { data, error } = await supabase
    .from("schedule_generation_runs")
    .update({
      status: "failed",
      current_stage: "failed",
      failed_at: new Date().toISOString(),
      failure_message: failureMessage,
    })
    .eq("id", runId)
    .eq("period_id", periodId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("schedule generation run failure update failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      runId,
      periodId,
    });
  }
}

function mapScheduleBudgetError(error: { code?: string; message: string }) {
  if (error.code === "42501") {
    return "You do not have permission to update staffing budgets.";
  }

  return error.message || "The staffing budget could not be saved right now.";
}

export async function updateSchedulePeriodBudgetAction(
  _previousState: ScheduleBudgetMutationState,
  formData: FormData,
): Promise<ScheduleBudgetMutationState> {
  const periodId = getStringValue(formData, "periodId");
  const monthlyBudgetEurInput = getStringValue(formData, "monthlyBudgetEur");

  if (!periodId) {
    return {
      status: "error",
      message: "Choose a schedule period before saving the staffing budget.",
    };
  }

  const fieldErrors: ScheduleBudgetMutationState["fieldErrors"] = {};
  const monthlyBudgetEur = parseOptionalNonNegativeCurrency(monthlyBudgetEurInput, "Monthly budget");

  if (monthlyBudgetEur.error) {
    fieldErrors.monthlyBudgetEur = monthlyBudgetEur.error;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted budget fields before saving.",
      fieldErrors,
    };
  }

  const { supabase, user, message } = await getAuthorizedManagerContext();

  if (!user) {
    return {
      status: "error",
      message: message ?? "You do not have permission to update staffing budgets.",
    };
  }

  const { data: updatedPeriod, error } = await supabase
    .from("schedule_periods")
    .update({
      monthly_staff_budget_eur: monthlyBudgetEur.value,
    })
    .eq("id", periodId)
    .select("id")
    .maybeSingle();

  if (error || !updatedPeriod) {
    console.error("schedule period budget update failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      periodId,
      userId: user.id,
    });

    return {
      status: "error",
      message: mapScheduleBudgetError(error ?? { message: "The staffing budget could not be saved." }),
    };
  }

  revalidatePath("/admin/schedule");

  return {
    status: "success",
    message:
      monthlyBudgetEur.value === null
        ? "Monthly staffing budget cleared."
        : "Monthly staffing budget updated.",
  };
}

export async function queueScheduleGenerationAction(
  _previousState: ScheduleMutationState,
  formData: FormData,
): Promise<ScheduleMutationState> {
  const periodId = getStringValue(formData, "periodId");

  if (!periodId) {
    return {
      status: "error",
      message: "Choose a schedule period before starting generation.",
    };
  }

  const { supabase, user, message } = await getAuthorizedManagerContext();

  if (!user) {
    return { status: "error", message: message ?? "You do not have permission to manage schedules." };
  }

  const readinessInputs = await loadReadinessInputs(supabase, periodId);

  if (!readinessInputs.period || !readinessInputs.readiness) {
    return {
      status: "error",
      message: "The selected schedule period could not be found.",
    };
  }

  if (!readinessInputs.readiness.allReady) {
    return {
      status: "error",
      message: "This schedule period is not ready for generation yet. Fix the blocking readiness items first.",
    };
  }

  const { data, error } = await supabase.rpc("queue_schedule_generation_run", {
    p_period_id: periodId,
  });

  if (error || !data) {
    console.error("queue_schedule_generation_run failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      periodId,
      userId: user.id,
    });

    return {
      status: "error",
      message: mapScheduleRpcError(error ?? { message: "Schedule generation could not be queued." }),
    };
  }

  const orchestrationResult = await startScheduleGenerationOrchestration({
    webhookUrl: process.env.N8N_SCHEDULE_GENERATION_WEBHOOK_URL,
    payload: {
      generation_run_id: data,
      period_id: periodId,
    },
    markRunFailed: async (failureMessage) => {
      await markScheduleGenerationRunFailed({
        supabase,
        runId: data,
        periodId,
        failureMessage,
      });
    },
  });

  if (!orchestrationResult.ok) {
    revalidatePath("/admin/schedule");

    return {
      status: "error",
      message: orchestrationResult.managerMessage,
      runId: data,
    };
  }

  revalidatePath("/admin/schedule");

  return {
    status: "success",
    message: "Draft generation queued. Orchestration has been notified.",
    runId: data,
  };
}

export async function publishSchedulePeriodAction(
  _previousState: ScheduleMutationState,
  formData: FormData,
): Promise<ScheduleMutationState> {
  const periodId = getStringValue(formData, "periodId");

  if (!periodId) {
    return {
      status: "error",
      message: "Choose a schedule period before publishing.",
    };
  }

  const { supabase, user, message } = await getAuthorizedManagerContext();

  if (!user) {
    return { status: "error", message: message ?? "You do not have permission to manage schedules." };
  }

  const { error } = await supabase.rpc("publish_schedule_period", {
    p_period_id: periodId,
  });

  if (error) {
    console.error("publish_schedule_period failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      periodId,
      userId: user.id,
    });

    return {
      status: "error",
      message: mapScheduleRpcError(error),
    };
  }

  revalidatePath("/admin/schedule");

  return {
    status: "success",
    message: "Schedule published successfully.",
  };
}
