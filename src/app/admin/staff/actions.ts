"use server";

import { revalidatePath } from "next/cache";
import {
  isManagerOrAdmin,
  TRAINING_PHASE_VALUES,
  WORK_ROLE_VALUES,
  type UpdateStaffActionState,
} from "@/lib/admin/staff";
import {
  resolveTrainingCompletionDate,
  validateStaffTrainingForm,
} from "@/lib/admin/staff-training";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, TrainingPhase, WorkRole } from "@/lib/supabase/types";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getTrimmedValue(formData: FormData, key: string) {
  return getStringValue(formData, key).trim();
}

function parseOptionalNumber(value: string, fieldLabel: string) {
  if (!value.trim()) {
    return { value: null, error: null };
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, error: `${fieldLabel} must be 0 or greater.` };
  }

  return { value: parsed, error: null };
}

function isWorkRole(value: string): value is WorkRole {
  return WORK_ROLE_VALUES.has(value as WorkRole);
}

function isTrainingPhase(value: string): value is TrainingPhase {
  return TRAINING_PHASE_VALUES.has(value as TrainingPhase);
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function mapStaffAdminRpcError(
  error: { code?: string; message: string },
  nextTrainingPhase: TrainingPhase | null,
) {
  if (error.code === "42501") {
    return "You do not have permission to update staff records.";
  }

  if (error.message.includes("No active employment contract")) {
    return "No active employment contract was found for this staff member.";
  }

  if (
    error.message.includes("completed opening-training event") ||
    error.message.includes("completed closing-training event")
  ) {
    if (nextTrainingPhase === "phase_3_fully_trained") {
      return "Phase 3 is still locked for this person. Record both opening and closing training as completed first, then save Phase 3.";
    }

    if (nextTrainingPhase === "phase_2_opening_independent") {
      return "Phase 2 is still locked for this person. Record opening training as completed first, then save Phase 2.";
    }

    return "This training phase cannot be selected yet because the required training step has not been completed.";
  }

  if (error.message.includes("No training status row")) {
    return "No training status record was found for this staff member.";
  }

  if (error.message.includes("Opening training completion is required")) {
    return "Phase 2 requires opening training, and Phase 3 requires both opening and closing training.";
  }

  if (error.message.includes("Closing training completion is required")) {
    return "Phase 3 requires both opening and closing training.";
  }

  return "Staff member could not be updated. Please try again.";
}

export async function updateStaffMemberAction(
  _previousState: UpdateStaffActionState,
  formData: FormData,
): Promise<UpdateStaffActionState> {
  const staffId = getTrimmedValue(formData, "staffId");
  const staffName = getTrimmedValue(formData, "staffName");
  const workRoleInput = getTrimmedValue(formData, "workRole");
  const schedulingRuleRoleInput = getTrimmedValue(formData, "schedulingRuleRole");
  const hourlyRateInput = getTrimmedValue(formData, "hourlyRate");
  const minShiftsInput = getTrimmedValue(formData, "minShiftsPerWeek");
  const targetShiftsInput = getTrimmedValue(formData, "targetShiftsPerWeek");
  const maxShiftsInput = getTrimmedValue(formData, "maxShiftsPerWeek");
  const trainingPhaseInput = getTrimmedValue(formData, "trainingPhase");
  const openingTrainingCompleted = getStringValue(formData, "openingTrainingCompleted") === "true";
  const openingTrainingCompletedOnInput = getTrimmedValue(formData, "openingTrainingCompletedOn");
  const currentOpeningTrainingCompletedOn = getTrimmedValue(
    formData,
    "currentOpeningTrainingCompletedOn",
  );
  const closingTrainingCompleted = getStringValue(formData, "closingTrainingCompleted") === "true";
  const closingTrainingCompletedOnInput = getTrimmedValue(formData, "closingTrainingCompletedOn");
  const currentClosingTrainingCompletedOn = getTrimmedValue(
    formData,
    "currentClosingTrainingCompletedOn",
  );
  const currentTrainingNote = getTrimmedValue(formData, "currentTrainingNote");
  const deactivateConfirmed = getStringValue(formData, "deactivateConfirmed") === "on";
  const isActive = getStringValue(formData, "isActive") === "true";
  const wasActive = getStringValue(formData, "wasActive") === "true";
  const hasTrainingRecord = getStringValue(formData, "hasTrainingRecord") === "true";

  if (!staffId) {
    return {
      status: "error",
      message: "We couldn't identify the staff member you tried to update.",
    };
  }

  const fieldErrors: UpdateStaffActionState["fieldErrors"] = {};

  if (!isWorkRole(workRoleInput)) {
    fieldErrors.workRole = "Select a valid work role.";
  }

  if (!isWorkRole(schedulingRuleRoleInput)) {
    fieldErrors.schedulingRuleRole = "Select a valid scheduling rule group.";
  }

  const hourlyRate = parseOptionalNumber(hourlyRateInput, "Hourly rate");
  const minShifts = parseOptionalNumber(minShiftsInput, "Minimum shifts/week");
  const targetShifts = parseOptionalNumber(targetShiftsInput, "Target shifts/week");
  const maxShifts = parseOptionalNumber(maxShiftsInput, "Maximum shifts/week");

  if (hourlyRate.error) fieldErrors.hourlyRate = hourlyRate.error;
  if (minShifts.error) fieldErrors.minShiftsPerWeek = minShifts.error;
  if (targetShifts.error) fieldErrors.targetShiftsPerWeek = targetShifts.error;
  if (maxShifts.error) fieldErrors.maxShiftsPerWeek = maxShifts.error;

  if (targetShifts.value === null) {
    fieldErrors.targetShiftsPerWeek = "Target shifts/week is required.";
  }

  if (minShifts.value === null) {
    fieldErrors.minShiftsPerWeek = "Minimum shifts/week is required.";
  }

  if (minShifts.value !== null && targetShifts.value !== null && targetShifts.value < minShifts.value) {
    fieldErrors.targetShiftsPerWeek = "Target shifts/week must be at least the minimum.";
  }

  if (targetShifts.value !== null && maxShifts.value !== null && maxShifts.value < targetShifts.value) {
    fieldErrors.maxShiftsPerWeek = "Maximum shifts/week must be empty or at least the target.";
  }

  let nextTrainingPhase: TrainingPhase | null = null;

  if (hasTrainingRecord) {
    if (!isTrainingPhase(trainingPhaseInput)) {
      fieldErrors.trainingPhase = "Select a valid training phase.";
    } else {
      nextTrainingPhase = trainingPhaseInput;
    }
  }

  if (nextTrainingPhase) {
    Object.assign(
      fieldErrors,
      validateStaffTrainingForm({
        hasTrainingRecord,
        trainingPhase: nextTrainingPhase,
        openingTrainingCompleted,
        openingTrainingCompletedOn: openingTrainingCompletedOnInput,
        closingTrainingCompleted,
        closingTrainingCompletedOn: closingTrainingCompletedOnInput,
      }),
    );
  }

  if (wasActive && !isActive && !deactivateConfirmed) {
    fieldErrors.isActive = "Confirm deactivation before saving an inactive status.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields before saving.",
      fieldErrors,
    };
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      status: "error",
      message: "Your session expired. Sign in again and retry.",
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, app_role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active || !isManagerOrAdmin(profile.app_role)) {
    return {
      status: "error",
      message: "You do not have permission to update staff records.",
    };
  }

  const openingTrainingCompletedOn = hasTrainingRecord
    ? resolveTrainingCompletionDate({
        completed: openingTrainingCompleted,
        requestedDate: openingTrainingCompletedOnInput,
        existingDate: currentOpeningTrainingCompletedOn,
        fallbackDate: getTodayDateString(),
      })
    : null;
  const closingTrainingCompletedOn = hasTrainingRecord
    ? resolveTrainingCompletionDate({
        completed: closingTrainingCompleted,
        requestedDate: closingTrainingCompletedOnInput,
        existingDate: currentClosingTrainingCompletedOn,
        fallbackDate: getTodayDateString(),
      })
    : null;

  const rpcArgs: Database["public"]["Functions"]["update_staff_admin_record"]["Args"] = {
    p_staff_id: staffId,
    p_work_role: workRoleInput as WorkRole,
    p_scheduling_rule_role: schedulingRuleRoleInput as WorkRole,
    p_hourly_rate: hourlyRate.value,
    p_is_active: isActive,
    p_min_shifts_per_week: minShifts.value as number,
    p_target_shifts_per_week: targetShifts.value as number,
    p_max_shifts_per_week: maxShifts.value,
    p_training_phase: nextTrainingPhase,
    p_opening_training_completed: hasTrainingRecord ? openingTrainingCompleted : null,
    p_opening_training_completed_on: openingTrainingCompletedOn,
    p_closing_training_completed: hasTrainingRecord ? closingTrainingCompleted : null,
    p_closing_training_completed_on: closingTrainingCompletedOn,
    p_training_note: hasTrainingRecord ? currentTrainingNote || null : null,
  };

  const { error } = await supabase.rpc("update_staff_admin_record", rpcArgs);

  if (error) {
    console.error("update_staff_admin_record failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      staffId,
      userId: user.id,
    });

    return {
      status: "error",
      message: mapStaffAdminRpcError(error, nextTrainingPhase),
    };
  }

  revalidatePath("/admin/staff");

  return {
    status: "success",
    message: `${staffName || "Staff member"} was updated successfully.`,
    updatedStaffId: staffId,
  };
}
