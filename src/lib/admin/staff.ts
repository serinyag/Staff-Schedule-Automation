import type {
  AppRole,
  EmploymentContractRow,
  ProfileRow,
  StaffMemberRow,
  StaffTrainingStatusRow,
  TrainingPhase,
  WorkRole,
} from "@/lib/supabase/types";

export type StaffAdminRecord = {
  id: string;
  fullName: string;
  workRole: WorkRole;
  schedulingRuleRole: WorkRole;
  hourlyRate: number | null;
  isActive: boolean;
  contract: {
    id: string;
    minShiftsPerWeek: number;
    targetShiftsPerWeek: number;
    maxShiftsPerWeek: number | null;
    startDate: string;
    endDate: string | null;
  } | null;
  training: {
    phase: TrainingPhase;
    phaseStartedOn: string;
  } | null;
};

export type StaffSummary = {
  totalActiveStaff: number;
  managers: number;
  coreTeam: number;
  hosts: number;
  trainees: number;
};

export type StaffFilter =
  | "all"
  | "active"
  | "inactive"
  | "manager"
  | "core_team"
  | "host"
  | "trainees";

export type UpdateStaffActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Partial<Record<StaffFormField, string>>;
  updatedStaffId?: string;
};

export type StaffFormField =
  | "workRole"
  | "schedulingRuleRole"
  | "hourlyRate"
  | "minShiftsPerWeek"
  | "targetShiftsPerWeek"
  | "maxShiftsPerWeek"
  | "trainingPhase"
  | "isActive";

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
      "Must work with a fully trained employee. Initial trainee shifts may require the designated mentor.",
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
  staffRows: StaffMemberRow[],
  contractRows: EmploymentContractRow[],
  trainingRows: StaffTrainingStatusRow[],
  today = getTodayDateString(),
) {
  const contractsByStaffId = new Map<string, EmploymentContractRow[]>();
  const trainingByStaffId = new Map<string, StaffTrainingStatusRow>();

  for (const contract of contractRows) {
    const contracts = contractsByStaffId.get(contract.staff_id) ?? [];
    contracts.push(contract);
    contractsByStaffId.set(contract.staff_id, contracts);
  }

  for (const training of trainingRows) {
    trainingByStaffId.set(training.staff_id, training);
  }

  return staffRows.map<StaffAdminRecord>((staff) => {
    const activeContract = findActiveContract(contractsByStaffId.get(staff.id) ?? [], today);
    const training = trainingByStaffId.get(staff.id) ?? null;

    return {
      id: staff.id,
      fullName: staff.full_name,
      workRole: staff.work_role,
      schedulingRuleRole: staff.scheduling_rule_role,
      hourlyRate: staff.hourly_rate,
      isActive: staff.is_active,
      contract: activeContract
        ? {
            id: activeContract.id,
            minShiftsPerWeek: activeContract.min_shifts_per_week,
            targetShiftsPerWeek: activeContract.target_shifts_per_week,
            maxShiftsPerWeek: activeContract.max_shifts_per_week,
            startDate: activeContract.start_date,
            endDate: activeContract.end_date,
          }
        : null,
      training: training
        ? {
            phase: training.phase,
            phaseStartedOn: training.phase_started_on,
          }
        : null,
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

      return summary;
    },
    {
      totalActiveStaff: 0,
      managers: 0,
      coreTeam: 0,
      hosts: 0,
      trainees: 0,
    },
  );
}

export function findActiveContract(contracts: EmploymentContractRow[], today: string) {
  return contracts
    .filter((contract) => contract.start_date <= today && (!contract.end_date || contract.end_date >= today))
    .sort((left, right) => right.start_date.localeCompare(left.start_date))[0] ?? null;
}

export function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeNextPath(path: string | undefined) {
  if (!path || !path.startsWith("/")) {
    return "/admin/staff";
  }

  return path;
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
