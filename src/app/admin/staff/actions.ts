"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  isManagerOrAdmin,
  TRAINING_PHASE_VALUES,
  WORK_ROLE_VALUES,
  type UpdateStaffActionState,
} from "@/lib/admin/staff";
import {
  canAssignAppRole,
  validateStaffOnboardingForm,
} from "@/lib/admin/staff-onboarding";
import {
  findAuthUserByNormalizedEmail,
  inviteAuthUserByEmail,
  sanitizeInvitationErrorMessage,
} from "@/lib/admin/staff-auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AppRole,
  Database,
  StaffInvitationStatus,
  TrainingPhase,
  WorkRole,
} from "@/lib/supabase/types";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getTrimmedValue(formData: FormData, key: string) {
  return getStringValue(formData, key).trim();
}

function getCheckboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function isWorkRole(value: string): value is WorkRole {
  return WORK_ROLE_VALUES.has(value as WorkRole);
}

function isTrainingPhase(value: string): value is TrainingPhase {
  return TRAINING_PHASE_VALUES.has(value as TrainingPhase);
}

function isAppRole(value: string): value is AppRole {
  return value === "admin" || value === "manager" || value === "staff";
}

function mapOnboardingRpcError(error: { code?: string; message: string }) {
  if (error.code === "42501") {
    return "You do not have permission to manage staff onboarding.";
  }

  if (error.code === "23505" || error.message.includes("already uses this email")) {
    return "Another staff record already uses this email address.";
  }

  if (error.message.includes("overlaps an existing contract")) {
    return "This contract overlaps an existing contract for the same staff member.";
  }

  if (error.message.includes("Opening training completion")) {
    return "Opening training completion is required for the selected training phase.";
  }

  if (error.message.includes("Closing training completion")) {
    return "Closing training completion is required for the selected training phase.";
  }

  return "Staff member could not be saved. Please try again.";
}

async function getRequestBaseUrl() {
  const headerStore = await headers();
  const origin = headerStore.get("origin");

  if (origin) {
    return origin;
  }

  const forwardedHost = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const forwardedProto = headerStore.get("x-forwarded-proto") ?? "https";

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

async function getAuthorizedManagerContext() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null, currentRole: null as AppRole | null, error: "Your session expired. Sign in again and retry." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, app_role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active || !isManagerOrAdmin(profile.app_role)) {
    return {
      supabase,
      user,
      currentRole: null as AppRole | null,
      error: "You do not have permission to manage staff records.",
    };
  }

  return {
    supabase,
    user,
    currentRole: profile.app_role,
    error: null as string | null,
  };
}

async function markPortalInvitationState(args: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  staffId: string;
  email: string;
  appRole: AppRole;
  loginAccessEnabled: boolean;
  authUserId?: string | null;
  invitationStatus?: StaffInvitationStatus | null;
  invitationLastError?: string | null;
}) {
  const { error } = await args.supabase.rpc("admin_set_staff_portal_access", {
    p_staff_id: args.staffId,
    p_email: args.email,
    p_app_role: args.appRole,
    p_login_access_enabled: args.loginAccessEnabled,
    p_auth_user_id: args.authUserId ?? null,
    p_invitation_status: args.invitationStatus ?? null,
    p_invitation_last_error: args.invitationLastError ?? null,
  });

  return error;
}

export async function updateStaffMemberAction(
  _previousState: UpdateStaffActionState,
  formData: FormData,
): Promise<UpdateStaffActionState> {
  const staffId = getTrimmedValue(formData, "staffId") || null;
  const fullName = getTrimmedValue(formData, "fullName");
  const email = getTrimmedValue(formData, "email");
  const appRoleInput = getTrimmedValue(formData, "appRole");
  const workRoleInput = getTrimmedValue(formData, "workRole");
  const schedulingRuleRoleInput = getTrimmedValue(formData, "schedulingRuleRole");
  const hourlyRate = getTrimmedValue(formData, "hourlyRate");
  const minimumShiftsPerWeek = getTrimmedValue(formData, "minShiftsPerWeek");
  const targetShiftsPerWeek = getTrimmedValue(formData, "targetShiftsPerWeek");
  const maximumShiftsPerWeek = getTrimmedValue(formData, "maxShiftsPerWeek");
  const standardShiftHours = getTrimmedValue(formData, "standardShiftHours");
  const contractStartDate = getTrimmedValue(formData, "contractStartDate");
  const contractEndDate = getTrimmedValue(formData, "contractEndDate");
  const contractNotes = getTrimmedValue(formData, "contractNotes");
  const trainingPhase = getTrimmedValue(formData, "trainingPhase");
  const trainingStartedOn = getTrimmedValue(formData, "trainingStartedOn");
  const phaseStartedOn = getTrimmedValue(formData, "phaseStartedOn");
  const targetCompletionOn = getTrimmedValue(formData, "targetCompletionOn");
  const openingTrainingCompletedOn = getTrimmedValue(formData, "openingTrainingCompletedOn");
  const closingTrainingCompletedOn = getTrimmedValue(formData, "closingTrainingCompletedOn");
  const trainingNotes = getTrimmedValue(formData, "trainingNotes");
  const loginAccessEnabled = getCheckboxValue(formData, "loginAccessEnabled");
  const sendInvitationNow = getCheckboxValue(formData, "sendInvitationNow");
  const isActive = getCheckboxValue(formData, "isActive");
  const isWildcardFillIn = getCheckboxValue(formData, "isWildcardFillIn");
  const deactivateConfirmed = getCheckboxValue(formData, "deactivateConfirmed");
  const wasActive = getStringValue(formData, "wasActive") === "true";

  const fieldErrors: UpdateStaffActionState["fieldErrors"] = {};

  if (!isWorkRole(workRoleInput)) {
    fieldErrors.workRole = "Select a valid work role.";
  }

  if (!isWorkRole(schedulingRuleRoleInput)) {
    fieldErrors.schedulingRuleRole = "Select a valid scheduling rule group.";
  }

  if (trainingPhase && !isTrainingPhase(trainingPhase)) {
    fieldErrors.trainingPhase = "Select a valid training phase.";
  }

  const validated = validateStaffOnboardingForm({
    fullName,
    email,
    appRole: isAppRole(appRoleInput) ? appRoleInput : "",
    workRole: workRoleInput,
    schedulingRuleRole: schedulingRuleRoleInput,
    hourlyRate,
    minimumShiftsPerWeek,
    targetShiftsPerWeek,
    maximumShiftsPerWeek,
    standardShiftHours,
    contractStartDate,
    contractEndDate,
    trainingPhase: isTrainingPhase(trainingPhase) ? trainingPhase : "",
    trainingStartedOn,
    phaseStartedOn,
    targetCompletionOn,
    openingTrainingCompletedOn,
    closingTrainingCompletedOn,
  });

  Object.assign(fieldErrors, validated.fieldErrors);

  if (wasActive && !isActive && !deactivateConfirmed) {
    fieldErrors.isActive = "Confirm deactivation before saving an inactive scheduling status.";
  }

  const { supabase, currentRole, error: authError } = await getAuthorizedManagerContext();

  if (authError) {
    return {
      status: "error",
      message: authError,
    };
  }

  if (!isAppRole(appRoleInput) || !canAssignAppRole(currentRole!, appRoleInput)) {
    fieldErrors.appRole =
      currentRole === "manager"
        ? "Managers can only create or update staff login access for staff accounts."
        : "Select a valid application access role.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields before saving.",
      fieldErrors,
    };
  }

  let authUser = null;

  try {
    authUser = await findAuthUserByNormalizedEmail(validated.normalizedEmail);
  } catch (error) {
    console.error("staff onboarding auth lookup failed", error);

    return {
      status: "error",
      message:
        "Auth administration is not configured yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel and your local environment before using staff onboarding.",
    };
  }

  const rpcArgs: Database["public"]["Functions"]["admin_upsert_staff_onboarding"]["Args"] = {
    p_existing_staff_id: staffId,
    p_full_name: fullName,
    p_email: email,
    p_app_role: appRoleInput as AppRole,
    p_login_access_enabled: loginAccessEnabled,
    p_scheduling_is_active: isActive,
    p_work_role: workRoleInput as WorkRole,
    p_scheduling_rule_role: schedulingRuleRoleInput as WorkRole,
    p_hourly_rate: validated.parsedValues.hourlyRate,
    p_is_wildcard_fill_in: isWildcardFillIn,
    p_min_shifts_per_week: validated.parsedValues.minimumShiftsPerWeek,
    p_target_shifts_per_week: validated.parsedValues.targetShiftsPerWeek,
    p_max_shifts_per_week: validated.parsedValues.maximumShiftsPerWeek,
    p_standard_shift_hours: validated.parsedValues.standardShiftHours,
    p_contract_start_date: contractStartDate,
    p_contract_end_date: contractEndDate || null,
    p_training_phase: trainingPhase as TrainingPhase,
    p_training_started_on: trainingStartedOn,
    p_phase_started_on: phaseStartedOn || null,
    p_target_completion_on: targetCompletionOn || null,
    p_opening_training_completed_on: openingTrainingCompletedOn || null,
    p_closing_training_completed_on: closingTrainingCompletedOn || null,
    p_contract_notes: contractNotes || null,
    p_training_notes: trainingNotes || null,
    p_existing_auth_user_id: authUser?.id ?? null,
  };

  const { data, error } = await supabase.rpc("admin_upsert_staff_onboarding", rpcArgs);

  if (error) {
    console.error("admin_upsert_staff_onboarding failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      staffId,
      normalizedEmail: validated.normalizedEmail,
    });

    return {
      status: "error",
      message: mapOnboardingRpcError(error),
    };
  }

  const savedRecord = data?.[0];

  if (!savedRecord?.staff_id) {
    return {
      status: "error",
      message: "The staff member was not saved correctly. Please try again.",
    };
  }

  if (loginAccessEnabled && !authUser && sendInvitationNow) {
    try {
      const baseUrl = await getRequestBaseUrl();
      const invitedUser = await inviteAuthUserByEmail(
        email,
        `${baseUrl}/auth/callback?next=/auth/redirect`,
      );

      const portalUpdateError = await markPortalInvitationState({
        supabase,
        staffId: savedRecord.staff_id,
        email,
        appRole: appRoleInput as AppRole,
        loginAccessEnabled,
        authUserId: invitedUser?.id ?? null,
        invitationStatus: "invitation_pending",
      });

      if (portalUpdateError) {
        console.error("staff invitation portal update failed", portalUpdateError);
      }
    } catch (error) {
      const sanitizedMessage = sanitizeInvitationErrorMessage(
        error instanceof Error ? error.message : "Unknown invitation error",
      );

      const portalUpdateError = await markPortalInvitationState({
        supabase,
        staffId: savedRecord.staff_id,
        email,
        appRole: appRoleInput as AppRole,
        loginAccessEnabled,
        invitationStatus: "invitation_failed",
        invitationLastError: sanitizedMessage,
      });

      if (portalUpdateError) {
        console.error("staff invitation failure state update failed", portalUpdateError);
      }

      revalidatePath("/admin/staff");

      return {
        status: "error",
        message: `Staff record saved, but the invitation could not be sent yet. ${sanitizedMessage}`,
        updatedStaffId: savedRecord.staff_id,
      };
    }
  }

  revalidatePath("/admin/staff");
  revalidatePath("/availability");

  const wasCreated = !staffId;
  const verb = wasCreated ? "created" : "updated";

  if (loginAccessEnabled && authUser) {
    return {
      status: "success",
      message: `${fullName} was ${verb} and linked to the existing login account.`,
      updatedStaffId: savedRecord.staff_id,
    };
  }

  if (loginAccessEnabled && !authUser && sendInvitationNow) {
    return {
      status: "success",
      message: `${fullName} was ${verb} and the invitation email was sent.`,
      updatedStaffId: savedRecord.staff_id,
    };
  }

  if (loginAccessEnabled && !authUser) {
    return {
      status: "success",
      message: `${fullName} was ${verb}. The staff record is ready to invite.`,
      updatedStaffId: savedRecord.staff_id,
    };
  }

  return {
    status: "success",
    message: `${fullName} was ${verb}. Login access remains disabled.`,
    updatedStaffId: savedRecord.staff_id,
  };
}
