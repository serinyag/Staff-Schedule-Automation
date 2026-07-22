import type { AppRole, Json, TrainingPhase } from "@/lib/supabase/types";

export type StaffInvitationStatus =
  | "not_invited"
  | "invitation_pending"
  | "invitation_failed"
  | "linked_existing_user";

export type StaffOnboardingStatus =
  | "incomplete_setup"
  | "ready_to_invite"
  | "invitation_pending"
  | "invitation_failed"
  | "active"
  | "login_inactive"
  | "scheduling_inactive"
  | "deactivated";

export type StaffPortalAccountRecord = {
  staffId: string;
  email: string;
  normalizedEmail: string;
  appRole: AppRole;
  loginAccessEnabled: boolean;
  authUserId: string | null;
  invitationStatus: StaffInvitationStatus;
  invitationSentAt: string | null;
  invitationLastError: string | null;
  lastLinkedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffAuditRecord = {
  id: string;
  staffId: string;
  actorProfileId: string | null;
  action: string;
  details: Json;
  createdAt: string;
};

export type StaffAuthUserRecord = {
  id: string;
  email: string;
  emailConfirmedAt: string | null;
  invitedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
};

export type StaffOnboardingIssue =
  | "missing_portal_account"
  | "missing_auth_user"
  | "missing_profile"
  | "inactive_profile"
  | "missing_active_contract"
  | "missing_training_status"
  | "inactive_for_scheduling";

export type DerivedStaffOnboardingState = {
  status: StaffOnboardingStatus;
  issues: StaffOnboardingIssue[];
};

export type StaffOnboardingFormField =
  | "fullName"
  | "email"
  | "appRole"
  | "workRole"
  | "schedulingRuleRole"
  | "hourlyRate"
  | "minimumShiftsPerWeek"
  | "targetShiftsPerWeek"
  | "maximumShiftsPerWeek"
  | "standardShiftHours"
  | "contractStartDate"
  | "contractEndDate"
  | "trainingPhase"
  | "trainingStartedOn"
  | "phaseStartedOn"
  | "targetCompletionOn"
  | "openingTrainingCompletedOn"
  | "closingTrainingCompletedOn";

export type StaffOnboardingFormInput = {
  fullName: string;
  email: string;
  appRole: AppRole | "";
  workRole: string;
  schedulingRuleRole: string;
  hourlyRate: string;
  minimumShiftsPerWeek: string;
  targetShiftsPerWeek: string;
  maximumShiftsPerWeek: string;
  standardShiftHours: string;
  contractStartDate: string;
  contractEndDate: string;
  trainingPhase: TrainingPhase | "";
  trainingStartedOn: string;
  phaseStartedOn: string;
  targetCompletionOn: string;
  openingTrainingCompletedOn: string;
  closingTrainingCompletedOn: string;
};

export const APP_ROLE_OPTIONS: Array<{ value: AppRole; label: string }> = [
  { value: "staff", label: "Staff" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

const APP_ROLE_VALUES = new Set<AppRole>(["admin", "manager", "staff"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAppRole(value: string): value is AppRole {
  return APP_ROLE_VALUES.has(value as AppRole);
}

export function normalizeStaffPortalEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isIsoDateOrEmpty(value: string) {
  return !value || ISO_DATE_PATTERN.test(value);
}

export function canAssignAppRole(currentRole: AppRole, nextRole: AppRole) {
  if (currentRole === "admin") {
    return true;
  }

  if (currentRole === "manager") {
    return nextRole === "staff";
  }

  return false;
}

export function validateStaffOnboardingForm(input: StaffOnboardingFormInput) {
  const fieldErrors: Partial<Record<StaffOnboardingFormField, string>> = {};
  const normalizedEmail = normalizeStaffPortalEmail(input.email);

  if (!input.fullName.trim()) {
    fieldErrors.fullName = "Full name is required.";
  }

  if (!normalizedEmail || !SIMPLE_EMAIL_PATTERN.test(normalizedEmail)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (!isAppRole(input.appRole)) {
    fieldErrors.appRole = "Select a valid application access role.";
  }

  if (!input.workRole) {
    fieldErrors.workRole = "Select a work role.";
  }

  if (!input.schedulingRuleRole) {
    fieldErrors.schedulingRuleRole = "Select a scheduling rule role.";
  }

  const hourlyRate = parseNonNegativeNumber(input.hourlyRate, "Hourly rate");
  const minimumShiftsPerWeek = parseNonNegativeNumber(
    input.minimumShiftsPerWeek,
    "Minimum shifts/week",
  );
  const targetShiftsPerWeek = parseNonNegativeNumber(
    input.targetShiftsPerWeek,
    "Target shifts/week",
  );
  const maximumShiftsPerWeek = parseOptionalNonNegativeNumber(
    input.maximumShiftsPerWeek,
    "Maximum shifts/week",
  );
  const standardShiftHours = parsePositiveNumber(
    input.standardShiftHours,
    "Standard shift hours",
  );

  if (hourlyRate.error) fieldErrors.hourlyRate = hourlyRate.error;
  if (minimumShiftsPerWeek.error) fieldErrors.minimumShiftsPerWeek = minimumShiftsPerWeek.error;
  if (targetShiftsPerWeek.error) fieldErrors.targetShiftsPerWeek = targetShiftsPerWeek.error;
  if (maximumShiftsPerWeek.error) fieldErrors.maximumShiftsPerWeek = maximumShiftsPerWeek.error;
  if (standardShiftHours.error) fieldErrors.standardShiftHours = standardShiftHours.error;

  if (minimumShiftsPerWeek.value !== null && targetShiftsPerWeek.value !== null) {
    if (targetShiftsPerWeek.value < minimumShiftsPerWeek.value) {
      fieldErrors.targetShiftsPerWeek = "Target shifts/week must be at least the minimum.";
    }
  }

  if (targetShiftsPerWeek.value !== null && maximumShiftsPerWeek.value !== null) {
    if (maximumShiftsPerWeek.value < targetShiftsPerWeek.value) {
      fieldErrors.maximumShiftsPerWeek =
        "Maximum shifts/week must be empty or at least the target.";
    }
  }

  if (!input.contractStartDate || !ISO_DATE_PATTERN.test(input.contractStartDate)) {
    fieldErrors.contractStartDate = "Contract start date is required.";
  }

  if (!isIsoDateOrEmpty(input.contractEndDate)) {
    fieldErrors.contractEndDate = "Use YYYY-MM-DD for the contract end date.";
  }

  if (
    input.contractStartDate &&
    input.contractEndDate &&
    ISO_DATE_PATTERN.test(input.contractStartDate) &&
    ISO_DATE_PATTERN.test(input.contractEndDate) &&
    input.contractEndDate < input.contractStartDate
  ) {
    fieldErrors.contractEndDate = "Contract end date must be on or after the start date.";
  }

  if (!input.trainingPhase) {
    fieldErrors.trainingPhase = "Select a training phase.";
  }

  if (!input.trainingStartedOn || !ISO_DATE_PATTERN.test(input.trainingStartedOn)) {
    fieldErrors.trainingStartedOn = "Training started date is required.";
  }

  if (!isIsoDateOrEmpty(input.phaseStartedOn)) {
    fieldErrors.phaseStartedOn = "Use YYYY-MM-DD for the phase started date.";
  }

  if (!isIsoDateOrEmpty(input.targetCompletionOn)) {
    fieldErrors.targetCompletionOn = "Use YYYY-MM-DD for the target completion date.";
  }

  if (!isIsoDateOrEmpty(input.openingTrainingCompletedOn)) {
    fieldErrors.openingTrainingCompletedOn = "Use YYYY-MM-DD for the opening training date.";
  }

  if (!isIsoDateOrEmpty(input.closingTrainingCompletedOn)) {
    fieldErrors.closingTrainingCompletedOn = "Use YYYY-MM-DD for the closing training date.";
  }

  if (
    input.trainingPhase === "phase_2_opening_independent" &&
    !input.openingTrainingCompletedOn
  ) {
    fieldErrors.openingTrainingCompletedOn =
      "Opening training completion is required for Phase 2.";
  }

  if (input.trainingPhase === "phase_3_fully_trained") {
    if (!input.openingTrainingCompletedOn) {
      fieldErrors.openingTrainingCompletedOn =
        "Opening training completion is required for Phase 3.";
    }

    if (!input.closingTrainingCompletedOn) {
      fieldErrors.closingTrainingCompletedOn =
        "Closing training completion is required for Phase 3.";
    }
  }

  return {
    fieldErrors,
    normalizedEmail,
    parsedValues: {
      hourlyRate: hourlyRate.value,
      minimumShiftsPerWeek: minimumShiftsPerWeek.value,
      targetShiftsPerWeek: targetShiftsPerWeek.value,
      maximumShiftsPerWeek: maximumShiftsPerWeek.value,
      standardShiftHours: standardShiftHours.value,
    },
  };
}

export function deriveStaffOnboardingState({
  portalAccount,
  authUser,
  profileExists,
  profileIsActive,
  hasActiveContract,
  hasTrainingStatus,
  schedulingIsActive,
}: {
  portalAccount: StaffPortalAccountRecord | null;
  authUser: StaffAuthUserRecord | null;
  profileExists: boolean;
  profileIsActive: boolean;
  hasActiveContract: boolean;
  hasTrainingStatus: boolean;
  schedulingIsActive: boolean;
}): DerivedStaffOnboardingState {
  const issues: StaffOnboardingIssue[] = [];

  if (!portalAccount) {
    issues.push("missing_portal_account");
  }

  if (!hasActiveContract) {
    issues.push("missing_active_contract");
  }

  if (!hasTrainingStatus) {
    issues.push("missing_training_status");
  }

  if (!schedulingIsActive) {
    issues.push("inactive_for_scheduling");
  }

  if (portalAccount) {
    if (!portalAccount.authUserId && !authUser) {
      issues.push("missing_auth_user");
    }

    if ((portalAccount.authUserId || authUser) && !profileExists) {
      issues.push("missing_profile");
    }

    if (
      (portalAccount.authUserId || authUser) &&
      profileExists &&
      !profileIsActive &&
      portalAccount.loginAccessEnabled
    ) {
      issues.push("inactive_profile");
    }
  }

  if (issues.includes("missing_portal_account") || issues.includes("missing_active_contract") || issues.includes("missing_training_status")) {
    return { status: "incomplete_setup", issues };
  }

  if (!portalAccount) {
    return { status: "incomplete_setup", issues };
  }

  if (!portalAccount.loginAccessEnabled && !schedulingIsActive) {
    return { status: "deactivated", issues };
  }

  if (portalAccount.invitationStatus === "invitation_failed") {
    return { status: "invitation_failed", issues };
  }

  if (portalAccount.invitationStatus === "invitation_pending") {
    return { status: "invitation_pending", issues };
  }

  if (!portalAccount.authUserId && !authUser && portalAccount.loginAccessEnabled) {
    return { status: "ready_to_invite", issues };
  }

  if (portalAccount.loginAccessEnabled && !profileIsActive) {
    return { status: "login_inactive", issues };
  }

  if (!schedulingIsActive) {
    return { status: "scheduling_inactive", issues };
  }

  return { status: "active", issues };
}

function parseNonNegativeNumber(value: string, label: string) {
  if (!value.trim()) {
    return { value: null as number | null, error: `${label} is required.` };
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null as number | null, error: `${label} must be 0 or greater.` };
  }

  return { value: parsed, error: null as string | null };
}

function parseOptionalNonNegativeNumber(value: string, label: string) {
  if (!value.trim()) {
    return { value: null as number | null, error: null as string | null };
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null as number | null, error: `${label} must be 0 or greater.` };
  }

  return { value: parsed, error: null as string | null };
}

function parsePositiveNumber(value: string, label: string) {
  if (!value.trim()) {
    return { value: null as number | null, error: `${label} is required.` };
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: null as number | null, error: `${label} must be greater than 0.` };
  }

  return { value: parsed, error: null as string | null };
}
