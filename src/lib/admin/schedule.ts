import { findActiveContract, formatRoleLabel } from "@/lib/admin/staff";
import { formatDateKey, getDefaultPeriodId, getWeekSlices, parseDateOnly } from "@/lib/admin/availability";
import type {
  AvailabilitySubmissionRow,
  DynamicViewRow,
  EmploymentContractRow,
  Json,
  ScheduleAssignmentLifecycle,
  ScheduleBudgetRow,
  ScheduleGenerationRunRow,
  ScheduleGenerationRunStatus,
  SchedulePeriodRow,
  ShiftAssignmentRow,
  ShiftRow,
  ShiftType,
  StaffMemberRow,
  StaffTrainingStatusRow,
} from "@/lib/supabase/types";

export type ScheduleIssueSeverity = "block" | "warning";

export type ScheduleValidationIssue = {
  severity: ScheduleIssueSeverity;
  message: string;
  code: string | null;
  dateKey: string | null;
  shiftType: ShiftType | null;
  staffName: string | null;
};

export type ReadinessCheck = {
  key: "availability" | "contracts" | "training" | "budget" | "shifts";
  label: string;
  status: "ready" | "warning";
  summary: string;
  details: string[];
  blocking: boolean;
};

export type ScheduleBudgetView = {
  id: string;
  scope: "role" | "staff";
  label: string;
  maxShifts: number;
  weeklyReference: number | null;
  notes: string | null;
};

export type ScheduleAssignmentView = {
  id: string;
  staffId: string;
  staffName: string;
  lifecycle: ScheduleAssignmentLifecycle;
  assignedAt: string | null;
  managerNote: string | null;
};

export type ScheduleShiftView = {
  id: string;
  dateKey: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  requiredCount: number;
  isOptional: boolean;
  notes: string | null;
  assignments: ScheduleAssignmentView[];
};

export type ScheduleWeekView = {
  id: string;
  label: string;
  startKey: string;
  endKey: string;
  dateKeys: string[];
  shiftsByDate: Array<{
    dateKey: string;
    shifts: ScheduleShiftView[];
  }>;
};

export type ScheduleMetrics = {
  coveragePercentage: number | null;
  contractMinimumsMet: number | null;
  contractMinimumsTotal: number | null;
  budgetUsed: number | null;
  budgetLimit: number | null;
  issueCount: number;
};

export type ScheduleGenerationRunSummary = {
  id: string;
  status: ScheduleGenerationRunStatus;
  statusLabel: string;
  currentStage: string;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
};

export type ScheduleCreatorViewModel = {
  readiness: {
    checks: ReadinessCheck[];
    allReady: boolean;
  };
  metrics: ScheduleMetrics;
  latestRun: ScheduleGenerationRunSummary | null;
  budgets: ScheduleBudgetView[];
  validationIssues: ScheduleValidationIssue[];
  weeks: ScheduleWeekView[];
  activeLifecycle: ScheduleAssignmentLifecycle | null;
  hasDraftSchedule: boolean;
  hasPublishedSchedule: boolean;
  canGenerateDraft: boolean;
  canPublishDraft: boolean;
};

export type SchedulePageData = {
  periods: SchedulePeriodRow[];
  selectedPeriod: SchedulePeriodRow;
  model: ScheduleCreatorViewModel;
};

function asRecord(value: Json | DynamicViewRow | unknown): Record<string, Json | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, Json | undefined>;
}

function asArray(value: Json | unknown): Json[] {
  if (Array.isArray(value)) {
    return value;
  }

  const record = asRecord(value);
  const items = record?.items;
  return Array.isArray(items) ? items : [];
}

function getString(record: Record<string, Json | undefined>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function getNumber(record: Record<string, Json | undefined>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }

  return null;
}

function getBoolean(record: Record<string, Json | undefined>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
}

function isShiftType(value: string | null): value is ShiftType {
  return value === "morning" || value === "day" || value === "evening";
}

const SHIFT_TYPE_ORDER: Record<ShiftType, number> = {
  morning: 0,
  day: 1,
  evening: 2,
};

const MISSING_STAFF_DISPLAY_NAME = "Staff record unavailable";

function compareNullableText(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").localeCompare(right ?? "");
}

function getStaffDisplayName(staff: Pick<StaffMemberRow, "full_name"> | null | undefined) {
  const displayName = staff?.full_name.trim();
  return displayName ? displayName : MISSING_STAFF_DISPLAY_NAME;
}

function statusLabel(status: ScheduleGenerationRunStatus) {
  switch (status) {
    case "queued":
      return "Queued";
    case "analyzing_availability":
      return "Analyzing availability";
    case "planning":
      return "Planning draft";
    case "fairness_review":
      return "Reviewing fairness";
    case "validating":
      return "Validating draft";
    case "completed":
      return "Draft ready";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function formatSchedulePeriodHeading(period: Pick<SchedulePeriodRow, "name">) {
  return period.name.toUpperCase();
}

export function formatSchedulePeriodOptionLabel(period: Pick<SchedulePeriodRow, "name" | "start_date">) {
  if (period.name.trim()) {
    return period.name;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(parseDateOnly(period.start_date));
}

export function formatScheduleWeekLabel(startKey: string, endKey: string) {
  const start = parseDateOnly(startKey);
  const end = parseDateOnly(endKey);

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(start) +
    "\u2013" +
    new Intl.DateTimeFormat("en-US", {
      month: start.getMonth() === end.getMonth() ? undefined : "long",
      day: "numeric",
    }).format(end);
}

export function formatScheduleLongDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(parseDateOnly(dateKey));
}

export function formatShiftTimeRange(
  shift: Pick<ShiftRow, "start_time" | "end_time"> | { startTime: string; endTime: string },
) {
  const start = ("start_time" in shift ? shift.start_time : shift.startTime).slice(0, 5);
  const end = ("end_time" in shift ? shift.end_time : shift.endTime).slice(0, 5);
  return `${start} - ${end}`;
}

export function formatScheduleStatusLabel(lifecycle: ScheduleAssignmentLifecycle | null) {
  if (lifecycle === "draft") {
    return "Draft";
  }

  if (lifecycle === "published") {
    return "Published";
  }

  return "No schedule yet";
}

export function formatBudgetScopeLabel(scope: "role" | "staff") {
  return scope === "role" ? "Role budget" : "Staff budget";
}

export function parseValidationIssues(payload: Json | null): ScheduleValidationIssue[] {
  return asArray(payload)
    .map((entry) => {
      const record = asRecord(entry);

      if (!record) {
        return null;
      }

      const severityRaw = getString(record, ["severity", "level", "issue_severity"]);
      const message = getString(record, ["message", "description", "reason", "issue_message"]);

      if (!message) {
        return null;
      }

      const severity: ScheduleIssueSeverity =
        severityRaw && severityRaw.toLowerCase() === "block" ? "block" : "warning";
      const shiftTypeRaw = getString(record, ["shift_type", "shiftType"]);

      return {
        severity,
        message,
        code: getString(record, ["code", "issue_code"]),
        dateKey: getString(record, ["shift_date", "date", "date_key"]),
        shiftType: isShiftType(shiftTypeRaw) ? shiftTypeRaw : null,
        staffName: getString(record, ["staff_name", "staffName", "full_name"]),
      } satisfies ScheduleValidationIssue;
    })
    .filter((issue): issue is ScheduleValidationIssue => issue !== null);
}

export function parseAssignmentBlockers(payload: Json | null) {
  return asArray(payload)
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }

      const message = getString(record, ["message", "description", "reason", "issue_message"]);

      if (!message) {
        return null;
      }

      return {
        code: getString(record, ["code", "issue_code"]),
        message,
        severity: getString(record, ["severity", "level"])?.toLowerCase() === "block" ? "block" : "warning",
      };
    })
    .filter(
      (
        blocker,
      ): blocker is {
        code: string | null;
        message: string;
        severity: "block" | "warning";
      } => blocker !== null,
    );
}

export function buildReadinessChecks({
  selectedPeriod,
  activeStaff,
  submissions,
  contracts,
  trainingRows,
  budgets,
  shifts,
}: {
  selectedPeriod: SchedulePeriodRow;
  activeStaff: StaffMemberRow[];
  submissions: AvailabilitySubmissionRow[];
  contracts: EmploymentContractRow[];
  trainingRows: StaffTrainingStatusRow[];
  budgets: ScheduleBudgetRow[];
  shifts: ShiftRow[];
}) {
  const today = formatDateKey(new Date());
  const submittedStaffIds = new Set(
    submissions.filter((submission) => submission.status === "submitted").map((submission) => submission.staff_id),
  );
  const activeContractsByStaffId = new Map<string, EmploymentContractRow | null>(
    activeStaff.map((staff) => [staff.id, findActiveContract(contracts.filter((contract) => contract.staff_id === staff.id), today)]),
  );
  const trainingStaffIds = new Set(trainingRows.map((row) => row.staff_id));
  const expectedRequiredShiftSlots = getWeekSlices(selectedPeriod.start_date, selectedPeriod.end_date).reduce(
    (count, week) => count + week.dateKeys.length * 2,
    0,
  );
  const createdRequiredShiftSlots = shifts.filter(
    (shift) =>
      (shift.shift_type === "morning" || shift.shift_type === "evening") && shift.is_optional === false,
  ).length;

  const missingAvailability = activeStaff
    .filter((staff) => !submittedStaffIds.has(staff.id))
    .map((staff) => staff.full_name);
  const missingContracts = activeStaff
    .filter((staff) => !activeContractsByStaffId.get(staff.id))
    .map((staff) => staff.full_name);
  const missingTraining = activeStaff
    .filter((staff) => !trainingStaffIds.has(staff.id))
    .map((staff) => staff.full_name);

  const checks: ReadinessCheck[] = [
    {
      key: "availability",
      label: "Availability",
      status: missingAvailability.length === 0 ? "ready" : "warning",
      summary: `${submittedStaffIds.size} / ${activeStaff.length} submitted`,
      details: missingAvailability,
      blocking: missingAvailability.length > 0,
    },
    {
      key: "contracts",
      label: "Contracts",
      status: missingContracts.length === 0 ? "ready" : "warning",
      summary: `${activeStaff.length - missingContracts.length} / ${activeStaff.length} configured`,
      details: missingContracts,
      blocking: missingContracts.length > 0,
    },
    {
      key: "training",
      label: "Training",
      status: missingTraining.length === 0 ? "ready" : "warning",
      summary: `${activeStaff.length - missingTraining.length} / ${activeStaff.length} configured`,
      details: missingTraining,
      blocking: missingTraining.length > 0,
    },
    {
      key: "budget",
      label: "Budget",
      status: budgets.length > 0 ? "ready" : "warning",
      summary: budgets.length > 0 ? `${budgets.length} budget record${budgets.length === 1 ? "" : "s"} configured` : "Staffing budget not configured",
      details: [],
      blocking: budgets.length === 0,
    },
    {
      key: "shifts",
      label: "Required shifts",
      status: createdRequiredShiftSlots === expectedRequiredShiftSlots ? "ready" : "warning",
      summary: `${createdRequiredShiftSlots} / ${expectedRequiredShiftSlots} created`,
      details: [],
      blocking: createdRequiredShiftSlots !== expectedRequiredShiftSlots,
    },
  ];

  return {
    checks,
    allReady: checks.every((check) => !check.blocking),
  };
}

function buildBudgetViews(budgets: ScheduleBudgetRow[], staffById: Map<string, StaffMemberRow>) {
  return budgets.map<ScheduleBudgetView>((budget) => {
    const roleLabel = budget.work_role ? formatRoleLabel(budget.work_role) : null;
    const staffLabel = budget.staff_id ? getStaffDisplayName(staffById.get(budget.staff_id)) : null;

    return {
      id: budget.id,
      scope: budget.scope,
      label: staffLabel ?? roleLabel ?? "Unlabelled budget",
      maxShifts: budget.max_shifts,
      weeklyReference: budget.weekly_reference,
      notes: budget.notes,
    };
  });
}

function buildScheduleWeeks({
  selectedPeriod,
  shifts,
  assignments,
  staffById,
  activeLifecycle,
}: {
  selectedPeriod: SchedulePeriodRow;
  shifts: ShiftRow[];
  assignments: ShiftAssignmentRow[];
  staffById: Map<string, StaffMemberRow>;
  activeLifecycle: ScheduleAssignmentLifecycle | null;
}) {
  const relevantAssignments = assignments.filter(
    (assignment) =>
      assignment.status === "assigned" &&
      (activeLifecycle ? assignment.lifecycle === activeLifecycle : true),
  );
  const assignmentsByShiftId = new Map<string, ScheduleAssignmentView[]>();

  for (const assignment of relevantAssignments) {
    const existing = assignmentsByShiftId.get(assignment.shift_id) ?? [];
    const staff = staffById.get(assignment.staff_id);

    existing.push({
      id: assignment.id,
      staffId: assignment.staff_id,
      staffName: getStaffDisplayName(staff),
      lifecycle: assignment.lifecycle,
      assignedAt: assignment.assigned_at,
      managerNote: assignment.manager_note,
    });

    assignmentsByShiftId.set(assignment.shift_id, existing);
  }

  const shiftMap = new Map(
    shifts.map((shift) => [
      shift.id,
      {
        id: shift.id,
        dateKey: shift.shift_date,
        shiftType: shift.shift_type,
        startTime: shift.start_time,
        endTime: shift.end_time,
        requiredCount: shift.required_count,
        isOptional: shift.is_optional,
        notes: shift.notes,
        assignments: (assignmentsByShiftId.get(shift.id) ?? []).sort((left, right) =>
          compareNullableText(left.staffName, right.staffName),
        ),
      } satisfies ScheduleShiftView,
    ]),
  );

  return getWeekSlices(selectedPeriod.start_date, selectedPeriod.end_date).map<ScheduleWeekView>((week) => ({
    id: week.id,
    label: formatScheduleWeekLabel(week.startKey, week.endKey),
    startKey: week.startKey,
    endKey: week.endKey,
    dateKeys: week.dateKeys,
    shiftsByDate: week.dateKeys.map((dateKey) => ({
      dateKey,
      shifts: shifts
        .filter((shift) => shift.shift_date === dateKey)
        .map((shift) => shiftMap.get(shift.id))
        .filter((shift): shift is ScheduleShiftView => shift !== undefined)
        .sort((left, right) => SHIFT_TYPE_ORDER[left.shiftType] - SHIFT_TYPE_ORDER[right.shiftType]),
    })),
  }));
}

function getCoveragePercentageFromRows(rows: DailyCoverageStatusRow[]) {
  const parsed = rows
    .map((row) => {
      const record = asRecord(row);
      if (!record) return null;

      const percentage = getNumber(record, ["coverage_percentage", "coveragePercent"]);
      if (percentage !== null) {
        return { percentage };
      }

      const required = getNumber(record, ["required_count", "required"]);
      const assigned = getNumber(record, ["assigned_count", "assigned"]);

      if (required === null || required <= 0 || assigned === null) {
        return null;
      }

      return { percentage: (Math.min(assigned, required) / required) * 100 };
    })
    .filter((row): row is { percentage: number } => row !== null);

  if (parsed.length === 0) {
    return null;
  }

  return Math.round(parsed.reduce((sum, row) => sum + row.percentage, 0) / parsed.length);
}

function getContractMetricFromRows(rows: ContractPeriodProgressRow[]) {
  const parsed = rows.map((row) => asRecord(row)).filter((row): row is Record<string, Json | undefined> => row !== null);

  if (parsed.length === 0) {
    return { met: null, total: null };
  }

  const directMet = getNumber(parsed[0], ["met_count", "minimums_met"]);
  const directTotal = getNumber(parsed[0], ["total_count", "staff_total"]);

  if (directMet !== null && directTotal !== null) {
    return { met: directMet, total: directTotal };
  }

  const total = parsed.length;
  const met = parsed.filter((record) => getBoolean(record, ["meets_minimum", "minimum_met"]) === true).length;

  return { met, total };
}

function getBudgetMetricFromRows(rows: PeriodBudgetUsageRow[]) {
  const parsed = rows.map((row) => asRecord(row)).filter((row): row is Record<string, Json | undefined> => row !== null);

  if (parsed.length === 0) {
    return { used: null, limit: null };
  }

  const directUsed = getNumber(parsed[0], ["used_shifts", "assigned_shifts", "budget_used"]);
  const directLimit = getNumber(parsed[0], ["max_shifts", "budget_limit", "total_budget"]);

  if (directUsed !== null || directLimit !== null) {
    return { used: directUsed, limit: directLimit };
  }

  return {
    used: parsed.reduce((sum, row) => sum + (getNumber(row, ["used_shifts", "assigned_shifts"]) ?? 0), 0),
    limit: parsed.reduce((sum, row) => sum + (getNumber(row, ["max_shifts", "budget_limit"]) ?? 0), 0),
  };
}

function buildScheduleMetrics({
  coverageRows,
  contractRows,
  budgetRows,
  budgets,
  shifts,
  assignments,
  activeLifecycle,
  validationIssues,
}: {
  coverageRows: DailyCoverageStatusRow[];
  contractRows: ContractPeriodProgressRow[];
  budgetRows: PeriodBudgetUsageRow[];
  budgets: ScheduleBudgetRow[];
  shifts: ShiftRow[];
  assignments: ShiftAssignmentRow[];
  activeLifecycle: ScheduleAssignmentLifecycle | null;
  validationIssues: ScheduleValidationIssue[];
}) {
  const filteredAssignments = assignments.filter(
    (assignment) =>
      assignment.status === "assigned" &&
      (activeLifecycle ? assignment.lifecycle === activeLifecycle : true),
  );
  const coverageFromViews = getCoveragePercentageFromRows(coverageRows);
  const contractFromViews = getContractMetricFromRows(contractRows);
  const budgetFromViews = getBudgetMetricFromRows(budgetRows);

  const coverageFallback = (() => {
    const requiredShifts = shifts.filter((shift) => shift.required_count > 0);

    if (requiredShifts.length === 0) {
      return null;
    }

    const assignedCountByShift = new Map<string, number>();
    for (const assignment of filteredAssignments) {
      assignedCountByShift.set(assignment.shift_id, (assignedCountByShift.get(assignment.shift_id) ?? 0) + 1);
    }

    let filled = 0;
    let total = 0;

    for (const shift of requiredShifts) {
      total += shift.required_count;
      filled += Math.min(assignedCountByShift.get(shift.id) ?? 0, shift.required_count);
    }

    return total > 0 ? Math.round((filled / total) * 100) : null;
  })();

  return {
    coveragePercentage: coverageFromViews ?? coverageFallback,
    contractMinimumsMet: contractFromViews.met,
    contractMinimumsTotal: contractFromViews.total,
    budgetUsed: budgetFromViews.used ?? filteredAssignments.length,
    budgetLimit:
      budgetFromViews.limit ??
      (budgets.length > 0 ? budgets.reduce((sum, budget) => sum + budget.max_shifts, 0) : null),
    issueCount: validationIssues.length,
  } satisfies ScheduleMetrics;
}

export function buildScheduleCreatorViewModel({
  selectedPeriod,
  activeStaff,
  submissions,
  contracts,
  trainingRows,
  budgets,
  shifts,
  assignments,
  generationRuns,
  validationIssues,
  coverageRows,
  contractRows,
  budgetRows,
}: {
  selectedPeriod: SchedulePeriodRow;
  activeStaff: StaffMemberRow[];
  submissions: AvailabilitySubmissionRow[];
  contracts: EmploymentContractRow[];
  trainingRows: StaffTrainingStatusRow[];
  budgets: ScheduleBudgetRow[];
  shifts: ShiftRow[];
  assignments: ShiftAssignmentRow[];
  generationRuns: ScheduleGenerationRunRow[];
  validationIssues: ScheduleValidationIssue[];
  coverageRows: DailyCoverageStatusRow[];
  contractRows: ContractPeriodProgressRow[];
  budgetRows: PeriodBudgetUsageRow[];
}) {
  const staffById = new Map(activeStaff.map((staff) => [staff.id, staff]));
  const readiness = buildReadinessChecks({
    selectedPeriod,
    activeStaff,
    submissions,
    contracts,
    trainingRows,
    budgets,
    shifts,
  });
  const hasDraftSchedule = assignments.some(
    (assignment) => assignment.status === "assigned" && assignment.lifecycle === "draft",
  );
  const hasPublishedSchedule = assignments.some(
    (assignment) => assignment.status === "assigned" && assignment.lifecycle === "published",
  );
  const activeLifecycle: ScheduleAssignmentLifecycle | null = hasDraftSchedule
    ? "draft"
    : hasPublishedSchedule
      ? "published"
      : null;
  const weeks = buildScheduleWeeks({
    selectedPeriod,
    shifts,
    assignments,
    staffById,
    activeLifecycle,
  });
  const metrics = buildScheduleMetrics({
    coverageRows,
    contractRows,
    budgetRows,
    budgets,
    shifts,
    assignments,
    activeLifecycle,
    validationIssues,
  });
  const latestRun = generationRuns[0]
    ? {
        id: generationRuns[0].id,
        status: generationRuns[0].status,
        statusLabel: statusLabel(generationRuns[0].status),
        currentStage: generationRuns[0].current_stage,
        startedAt: generationRuns[0].started_at,
        completedAt: generationRuns[0].completed_at,
        failedAt: generationRuns[0].failed_at,
        failureMessage: generationRuns[0].failure_message,
      }
    : null;

  return {
    readiness,
    metrics,
    latestRun,
    budgets: buildBudgetViews(budgets, staffById),
    validationIssues,
    weeks,
    activeLifecycle,
    hasDraftSchedule,
    hasPublishedSchedule,
    canGenerateDraft:
      readiness.allReady &&
      selectedPeriod.status !== "published" &&
      selectedPeriod.status !== "locked" &&
      (latestRun === null ||
        !["queued", "analyzing_availability", "planning", "fairness_review", "validating"].includes(
          latestRun.status,
        )),
    canPublishDraft:
      hasDraftSchedule &&
      validationIssues.every((issue) => issue.severity !== "block") &&
      selectedPeriod.status !== "locked",
  } satisfies ScheduleCreatorViewModel;
}

export async function loadSchedulePageData({
  supabase,
  requestedPeriodId,
}: {
  supabase: {
    from: (table: string) => {
      select: (query: string) => {
        order: (column: string, options?: { ascending?: boolean }) => PromiseLike<{ data: SchedulePeriodRow[] | null; error: { message: string } | null }>;
      };
    };
  };
  requestedPeriodId: string | undefined;
}) {
  const periodResult = await supabase
    .from("schedule_periods")
    .select(
      "id, name, start_date, end_date, availability_deadline, status, published_at, created_by, created_at, updated_at",
    )
    .order("start_date", { ascending: true });

  if (periodResult.error) {
    throw periodResult.error;
  }

  const periods = periodResult.data ?? [];

  if (periods.length === 0) {
    return { periods, selectedPeriodId: null };
  }

  const defaultPeriodId = getDefaultPeriodId(periods);
  const selectedPeriodId = periods.some((period) => period.id === requestedPeriodId)
    ? requestedPeriodId!
    : defaultPeriodId;

  return {
    periods,
    selectedPeriodId,
  };
}

export type DailyCoverageStatusRow = DynamicViewRow;
export type ContractPeriodProgressRow = DynamicViewRow;
export type PeriodBudgetUsageRow = DynamicViewRow;
