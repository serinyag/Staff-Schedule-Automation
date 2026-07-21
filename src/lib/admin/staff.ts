import type {
  AppRole,
  EmploymentContractRow,
  ProfileRow,
  StaffAdminAuditLogRow,
  StaffMemberRow,
  StaffPortalAccountRow,
  StaffTrainingStatusRow,
  TrainingPhase,
  WorkRole,
} from "@/lib/supabase/types";
import { buildTrainingRecordWarnings, normalizeOptionalIsoDate } from "@/lib/admin/staff-training";
import {
  deriveStaffOnboardingState,
  type StaffAuthUserRecord,
  type StaffAuditRecord,
  type StaffOnboardingIssue,
  type StaffOnboardingStatus,
  type StaffPortalAccountRecord,
} from "@/lib/admin/staff-onboarding";

export type StaffAdminRecord = {
  id: string;
  fullName: string;
  email: string | null;
  workRole: WorkRole;
  schedulingRuleRole: WorkRole;
  hourlyRate: number | null;
  isActive: boolean;
  isWildcardFillIn: boolean;
  profile: {
    id: string;
    appRole: AppRole;
    isActive: boolean;
  } | null;
  contract: {
    id: string;
    minShiftsPerWeek: number;
    targetShiftsPerWeek: number;
    maxShiftsPerWeek: number | null;
    standardShiftHours: number;
    startDate: string;
    endDate: string | null;
    notes: string | null;
  } | null;
  training: {
    phase: TrainingPhase;
    trainingStartedOn: string;
    targetCompletionOn: string | null;
    phaseStartedOn: string;
    openingTrainingCompleted: boolean;
    openingTrainingCompletedOn: string | null;
    closingTrainingCompleted: boolean;
    closingTrainingCompletedOn: string | null;
    notes: string | null;
    warnings: string[];
  } | null;
  portal: StaffPortalAccountRecord | null;
  authUser: StaffAuthUserRecord | null;
  onboarding: {
    status: StaffOnboardingStatus;
    issues: StaffOnboardingIssue[];
    canSendInvitation: boolean;
    canResendInvitation: boolean;
    canLinkExistingAuthUser: boolean;
    canActivateLogin: boolean;
    canDeactivateLogin: boolean;
  };
  recentAudit: StaffAuditRecord[];
};

export type StaffSummary = {
  totalActiveStaff: number;
  managers: number;
  coreTeam: number;
  hosts: number;
  trainees: number;
  needsSetup: number;
  pendingInvitations: number;
  loginInactive: number;
  schedulingInactive: number;
};

export type StaffFilter =
  | "all"
  | "active"
  | "inactive"
  | "manager"
  | "core_team"
  | "host"
  | "trainees"
  | "needs_setup"
  | "ready_to_invite"
  | "invitation_pending"
  | "missing_contract"
  | "missing_training"
  | "login_inactive"
  | "scheduling_inactive";

export type UpdateStaffActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Partial<Record<StaffFormField, string>>;
  updatedStaffId?: string;
};

export type StaffFormField =
  | "fullName"
  | "email"
  | "appRole"
  | "loginAccessEnabled"
  | "sendInvitationNow"
  | "workRole"
  | "schedulingRuleRole"
  | "hourlyRate"
  | "standardShiftHours"
  | "minShiftsPerWeek"
  | "targetShiftsPerWeek"
  | "maxShiftsPerWeek"
  | "contractStartDate"
  | "contractEndDate"
  | "trainingStartedOn"
  | "phaseStartedOn"
  | "targetCompletionOn"
  | "trainingPhase"
  | "openingTrainingCompletedOn"
  | "closingTrainingCompletedOn"
  | "isActive"
  | "isWildcardFillIn";

export const INITIAL_UPDATE_STAFF_ACTION_STATE: UpdateStaffActionState = {
  status: "idle",
  message: "",
};

export const WORK_ROLE_OPTIONS: Array<{ value: WorkRole; label: string }> = [
  { value: "manager", label: "Manager" },
  { value: "core_team", label: "Core Team" },
  { value: "host", label: "Host" },
];

export const WORK_ROLE_VALUES = new Set<WorkRole>(["manager", "core_team", "host"]);

export const TRAINING_PHASE_OPTIONS: Array<{
  value: TrainingPhase;
  label: string;
  description: string;
}> = [
  {
    value: "phase_1_shadow_only",
    label: "Phase 1 — Shadow only",
    description:
      "Must work on the same shift as any fully trained Phase 3 teammate. No designated mentor is required.",
  },
  {
    value: "phase_2_opening_independent",
    label: "Phase 2 — Opening independent",
    description: "May open independently but cannot close alone.",
  },
  {
    value: "phase_3_fully_trained",
    label: "Phase 3 — Fully trained",
    description: "Fully trained and may work independently.",
  },
];

export const TRAINING_PHASE_VALUES = new Set<TrainingPhase>([
  "phase_1_shadow_only",
  "phase_2_opening_independent",
  "phase_3_fully_trained",
]);

export function isManagerOrAdmin(role: AppRole | null | undefined) {
  return role === "admin" || role === "manager";
}

export function formatRoleLabel(role: WorkRole) {
  if (role === "core_team") {
    return "Core Team";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function formatAppRoleLabel(role: AppRole) {
  if (role === "admin") {
    return "Admin";
  }

  if (role === "manager") {
    return "Manager";
  }

  return "Staff";
}

export function formatPhaseLabel(phase: TrainingPhase) {
  return TRAINING_PHASE_OPTIONS.find((option) => option.value === phase)?.label ?? phase;
}

export function formatCurrency(value: number | null) {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatShiftTriple(record: StaffAdminRecord) {
  if (!record.contract) {
    return "No active contract";
  }

  const max =
    record.contract.maxShiftsPerWeek === null ? "—" : stripTrailingZeros(record.contract.maxShiftsPerWeek);

  return `${stripTrailingZeros(record.contract.minShiftsPerWeek)} / ${stripTrailingZeros(
    record.contract.targetShiftsPerWeek,
  )} / ${max}`;
}

export function buildStaffAdminRecords(
  {
    staffRows,
    contractRows,
    trainingRows,
    profileRows,
    portalRows,
    auditRows,
    authUsersByNormalizedEmail,
    today = getTodayDateString(),
  }: {
    staffRows: StaffMemberRow[];
    contractRows: EmploymentContractRow[];
    trainingRows: StaffTrainingStatusRow[];
    profileRows: ProfileRow[];
    portalRows: StaffPortalAccountRow[];
    auditRows: StaffAdminAuditLogRow[];
    authUsersByNormalizedEmail: Map<string, StaffAuthUserRecord>;
    today?: string;
  },
) {
  const contractsByStaffId = new Map<string, EmploymentContractRow[]>();
  const trainingByStaffId = new Map<string, StaffTrainingStatusRow>();
  const profilesById = new Map<string, ProfileRow>();
  const portalByStaffId = new Map<string, StaffPortalAccountRow>();
  const auditByStaffId = new Map<string, StaffAuditRecord[]>();

  for (const contract of contractRows) {
    const contracts = contractsByStaffId.get(contract.staff_id) ?? [];
    contracts.push(contract);
    contractsByStaffId.set(contract.staff_id, contracts);
  }

  for (const training of trainingRows) {
    trainingByStaffId.set(training.staff_id, training);
  }

  for (const profile of profileRows) {
    profilesById.set(profile.id, profile);
  }

  for (const portal of portalRows) {
    portalByStaffId.set(portal.staff_id, portal);
  }

  for (const auditRow of auditRows) {
    const currentRows = auditByStaffId.get(auditRow.staff_id) ?? [];
    currentRows.push({
      id: auditRow.id,
      staffId: auditRow.staff_id,
      actorProfileId: auditRow.actor_profile_id,
      action: auditRow.action,
      details: auditRow.details,
      createdAt: auditRow.created_at,
    });
    auditByStaffId.set(auditRow.staff_id, currentRows);
  }

  return staffRows.map<StaffAdminRecord>((staff) => {
    const activeContract = findActiveContract(contractsByStaffId.get(staff.id) ?? [], today);
    const training = trainingByStaffId.get(staff.id) ?? null;
    const profile = staff.profile_id ? profilesById.get(staff.profile_id) ?? null : null;
    const portalRow = portalByStaffId.get(staff.id) ?? null;
    const portal: StaffPortalAccountRecord | null = portalRow
      ? {
          staffId: portalRow.staff_id,
          email: portalRow.email,
          normalizedEmail: portalRow.normalized_email,
          appRole: portalRow.app_role,
          loginAccessEnabled: portalRow.login_access_enabled,
          authUserId: portalRow.auth_user_id,
          invitationStatus: portalRow.invitation_status,
          invitationSentAt: portalRow.invitation_sent_at,
          invitationLastError: portalRow.invitation_last_error,
          lastLinkedAt: portalRow.last_linked_at,
          createdAt: portalRow.created_at,
          updatedAt: portalRow.updated_at,
        }
      : null;
    const authUser = portal ? authUsersByNormalizedEmail.get(portal.normalizedEmail) ?? null : null;
    const openingTrainingCompletedOn = training
      ? normalizeOptionalIsoDate(
          (
            training as StaffTrainingStatusRow & {
              opening_training_completed_on?: string | null;
            }
          ).opening_training_completed_on ?? "",
        ) ??
        (training.phase === "phase_1_shadow_only"
          ? null
          : normalizeOptionalIsoDate(training.phase_started_on))
      : null;
    const closingTrainingCompletedOn = training
      ? normalizeOptionalIsoDate(training.fully_trained_on ?? "")
      : null;
    const onboarding = deriveStaffOnboardingState({
      portalAccount: portal,
      authUser,
      profileExists: Boolean(profile),
      profileIsActive: profile?.is_active ?? false,
      hasActiveContract: Boolean(activeContract),
      hasTrainingStatus: Boolean(training),
      schedulingIsActive: staff.is_active,
    });

    return {
      id: staff.id,
      fullName: staff.full_name,
      email: portal?.email ?? authUser?.email ?? null,
      workRole: staff.work_role,
      schedulingRuleRole: staff.scheduling_rule_role,
      hourlyRate: staff.hourly_rate,
      isActive: staff.is_active,
      isWildcardFillIn: staff.is_wildcard_fill_in,
      profile: profile
        ? {
            id: profile.id,
            appRole: profile.app_role,
            isActive: profile.is_active,
          }
        : null,
      contract: activeContract
        ? {
            id: activeContract.id,
            minShiftsPerWeek: activeContract.min_shifts_per_week,
            targetShiftsPerWeek: activeContract.target_shifts_per_week,
            maxShiftsPerWeek: activeContract.max_shifts_per_week,
            standardShiftHours: activeContract.standard_shift_hours,
            startDate: activeContract.start_date,
            endDate: activeContract.end_date,
            notes: activeContract.notes,
          }
        : null,
      training: training
        ? {
            phase: training.phase,
            trainingStartedOn: training.training_started_on,
            targetCompletionOn: training.target_completion_on,
            phaseStartedOn: training.phase_started_on,
            openingTrainingCompleted: openingTrainingCompletedOn !== null,
            openingTrainingCompletedOn,
            closingTrainingCompleted: closingTrainingCompletedOn !== null,
            closingTrainingCompletedOn,
            notes: training.notes,
            warnings: buildTrainingRecordWarnings({
              trainingPhase: training.phase,
              openingTrainingCompletedOn,
              closingTrainingCompletedOn,
            }),
          }
        : null,
      portal,
      authUser,
      onboarding: {
        status: onboarding.status,
        issues: onboarding.issues,
        canSendInvitation:
          Boolean(portal?.loginAccessEnabled) &&
          !portal?.authUserId &&
          onboarding.status === "ready_to_invite",
        canResendInvitation:
          Boolean(portal?.loginAccessEnabled) &&
          onboarding.status === "invitation_failed",
        canLinkExistingAuthUser:
          Boolean(portal?.loginAccessEnabled) &&
          !portal?.authUserId &&
          Boolean(authUser),
        canActivateLogin:
          Boolean(portal?.loginAccessEnabled) &&
          Boolean(portal?.authUserId || authUser) &&
          profile?.is_active === false,
        canDeactivateLogin: Boolean(portal?.loginAccessEnabled && profile?.is_active),
      },
      recentAudit: (auditByStaffId.get(staff.id) ?? [])
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 5),
    };
  });
}

export function summarizeStaff(records: StaffAdminRecord[]): StaffSummary {
  return records.reduce<StaffSummary>(
    (summary, record) => {
      if (record.isActive) {
        summary.totalActiveStaff += 1;
      }

      if (record.workRole === "manager" && record.isActive) {
        summary.managers += 1;
      }

      if (record.workRole === "core_team" && record.isActive) {
        summary.coreTeam += 1;
      }

      if (record.workRole === "host" && record.isActive) {
        summary.hosts += 1;
      }

      if (
        record.training &&
        (record.training.phase === "phase_1_shadow_only" ||
          record.training.phase === "phase_2_opening_independent")
      ) {
        summary.trainees += 1;
      }

      if (record.onboarding.status === "incomplete_setup" || record.onboarding.status === "ready_to_invite") {
        summary.needsSetup += 1;
      }

      if (record.onboarding.status === "invitation_pending") {
        summary.pendingInvitations += 1;
      }

      if (record.onboarding.status === "login_inactive") {
        summary.loginInactive += 1;
      }

      if (record.onboarding.status === "scheduling_inactive") {
        summary.schedulingInactive += 1;
      }

      return summary;
    },
    {
      totalActiveStaff: 0,
      managers: 0,
      coreTeam: 0,
      hosts: 0,
      trainees: 0,
      needsSetup: 0,
      pendingInvitations: 0,
      loginInactive: 0,
      schedulingInactive: 0,
    },
  );
}

export function findActiveContract(contracts: EmploymentContractRow[], today: string) {
  return contracts
    .filter((contract) => contract.start_date <= today && (!contract.end_date || contract.end_date >= today))
    .sort((left, right) => right.start_date.localeCompare(left.start_date))[0] ?? null;
}

export function formatOnboardingStatus(status: StaffOnboardingStatus) {
  switch (status) {
    case "incomplete_setup":
      return "Setup incomplete";
    case "ready_to_invite":
      return "Ready to invite";
    case "invitation_pending":
      return "Invitation pending";
    case "invitation_failed":
      return "Invitation failed";
    case "active":
      return "Active";
    case "login_inactive":
      return "Login inactive";
    case "scheduling_inactive":
      return "Scheduling inactive";
    case "deactivated":
      return "Deactivated";
  }
}

export function formatOnboardingIssue(issue: StaffOnboardingIssue) {
  switch (issue) {
    case "missing_portal_account":
      return "Email and portal access have not been set up yet.";
    case "missing_auth_user":
      return "No Supabase Auth account is linked yet.";
    case "missing_profile":
      return "The application profile is missing.";
    case "inactive_profile":
      return "The application profile is inactive.";
    case "missing_active_contract":
      return "No active contract is available for scheduling.";
    case "missing_training_status":
      return "No training status record is available.";
    case "inactive_for_scheduling":
      return "This employee is not active for scheduling yet.";
  }
}

export function getProfileStateLabel(record: StaffAdminRecord) {
  if (!record.profile) {
    return "Missing profile";
  }

  return record.profile.isActive ? "Profile active" : "Profile inactive";
}

export function getAuthStateLabel(record: StaffAdminRecord) {
  if (record.authUser) {
    if (record.portal?.invitationStatus === "invitation_pending" && !record.authUser.emailConfirmedAt) {
      return "Invitation pending";
    }

    return "Auth account linked";
  }

  if (record.portal?.invitationStatus === "invitation_failed") {
    return "Invite failed";
  }

  if (record.portal?.loginAccessEnabled) {
    return "No Auth account";
  }

  return "Login disabled";
}

export function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function getProfileLabel(profile: Pick<ProfileRow, "app_role" | "is_active">) {
  if (!profile.is_active) {
    return "Inactive";
  }

  if (profile.app_role === "admin") {
    return "Admin";
  }

  if (profile.app_role === "manager") {
    return "Manager";
  }

  return "Staff";
}

export function stripTrailingZeros(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}
