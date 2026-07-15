import { findActiveContract } from "@/lib/admin/staff";
import { getDefaultPeriodId, getWeekSlices, parseDateOnly } from "@/lib/admin/availability";
import type {
  AvailabilitySubmissionRow,
  DynamicViewRow,
  EmploymentContractRow,
  Json,
  ScheduleAssignmentLifecycle,
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
  startTime: string | null;
  endTime: string | null;
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

export type ScheduleBudgetSummary = {
  monthlyBudgetEur: number | null;
  minimumRequiredEur: number | null;
  estimatedAssignedSpendEur: number | null;
  shortfallEur: number | null;
  remainingEur: number | null;
  meetsMinimumRequirement: boolean | null;
  missingMinimumRequirementInputs: string[];
};

export type ManagerReviewSummary = {
  assignmentCount: number | null;
  unfilledShiftCount: number | null;
  hardRuleViolationCount: number | null;
  softRuleWarningCount: number | null;
  humanReviewFlagCount: number | null;
  repairCandidateGroupCount: number | null;
  totalRecommendedCandidateCount: number | null;
  shiftsWithoutRuleCleanCandidates: number | null;
};

export type ManagerReviewBlockingIssue = {
  shiftId: string | null;
  shiftDate: string | null;
  shiftType: ShiftType | null;
  message: string;
  missingCount: number | null;
};

export type ManagerReviewCandidate = {
  staffName: string | null;
  blockerMessages: string[];
};

export type ManagerReviewRepairOption = {
  shiftId: string | null;
  shiftDate: string | null;
  shiftType: ShiftType | null;
  hasRuleCleanCandidate: boolean | null;
  recommendedCandidateCount: number | null;
  topBlockedCandidates: ManagerReviewCandidate[];
};

export type ManagerReview = {
  status: string | null;
  headline: string | null;
  readyForCommit: boolean | null;
  requiresHumanReview: boolean | null;
  summary: ManagerReviewSummary;
  blockingIssues: ManagerReviewBlockingIssue[];
  repairOptions: ManagerReviewRepairOption[];
  softWarnings: string[];
  humanReviewFlags: string[];
  nextActions: string[];
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
  managerReview: ManagerReview | null;
};

export type ScheduleCreatorViewModel = {
  readiness: {
    checks: ReadinessCheck[];
    allReady: boolean;
  };
  budget: ScheduleBudgetSummary;
  metrics: ScheduleMetrics;
  latestRun: ScheduleGenerationRunSummary | null;
  validationIssues: ScheduleValidationIssue[];
  weeks: ScheduleWeekView[];
  activeLifecycle: ScheduleAssignmentLifecycle | null;
  hasDraftSchedule: boolean;
  hasPublishedSchedule: boolean;
  needsDraftSave: boolean;
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

function getStringList(value: Json | unknown) {
  return asArray(value)
    .map((entry) => {
      if (typeof entry === "string" && entry.trim()) {
        return entry.trim();
      }

      const record = asRecord(entry);
      if (!record) {
        return null;
      }

      return getString(record, ["message", "label", "title", "headline", "action", "name", "full_name"]);
    })
    .filter((entry): entry is string => entry !== null);
}

function getArrayValue(record: Record<string, Json | undefined>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeShiftTime(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
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

function parseManagerReviewSummary(value: Json | unknown): ManagerReviewSummary {
  const record = asRecord(value);

  return {
    assignmentCount: record ? getNumber(record, ["assignment_count"]) : null,
    unfilledShiftCount: record ? getNumber(record, ["unfilled_shift_count"]) : null,
    hardRuleViolationCount: record ? getNumber(record, ["hard_rule_violation_count"]) : null,
    softRuleWarningCount: record ? getNumber(record, ["soft_rule_warning_count"]) : null,
    humanReviewFlagCount: record ? getNumber(record, ["human_review_flag_count"]) : null,
    repairCandidateGroupCount: record ? getNumber(record, ["repair_candidate_group_count"]) : null,
    totalRecommendedCandidateCount: record ? getNumber(record, ["total_recommended_candidate_count"]) : null,
    shiftsWithoutRuleCleanCandidates: record
      ? getNumber(record, ["shifts_without_rule_clean_candidates"])
      : null,
  };
}

function parseManagerReviewBlockingIssues(value: Json | unknown): ManagerReviewBlockingIssue[] {
  return dedupeManagerReviewBlockingIssues(
    asArray(value)
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }

      const message = getString(record, ["message", "headline", "description", "reason"]);
      if (!message) {
        return null;
      }

      const shiftTypeRaw = getString(record, ["shift_type", "shiftType"]);

      return {
        shiftId: getString(record, ["shift_id", "shiftId"]),
        shiftDate: getString(record, ["shift_date", "date", "date_key"]),
        shiftType: isShiftType(shiftTypeRaw) ? shiftTypeRaw : null,
        message,
        missingCount: getNumber(record, ["missing_count", "missingCount"]),
      } satisfies ManagerReviewBlockingIssue;
    })
    .filter((entry): entry is ManagerReviewBlockingIssue => entry !== null),
  );
}

function parseManagerReviewCandidates(value: Json | unknown): ManagerReviewCandidate[] {
  return asArray(value)
    .map((entry) => {
      if (typeof entry === "string" && entry.trim()) {
        return {
          staffName: entry.trim(),
          blockerMessages: [],
        } satisfies ManagerReviewCandidate;
      }

      const record = asRecord(entry);
      if (!record) {
        return null;
      }

      return {
        staffName: getString(record, ["staff_name", "staffName", "full_name", "name"]),
        blockerMessages: getStringList(
          getArrayValue(record, ["blocker_messages", "blockers", "reasons", "messages"]),
        ),
      } satisfies ManagerReviewCandidate;
    })
    .filter((entry): entry is ManagerReviewCandidate => entry !== null);
}

function dedupeManagerReviewBlockingIssues(issues: ManagerReviewBlockingIssue[]) {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = issue.shiftId
      ? `shift:${issue.shiftId}`
      : `fallback:${issue.shiftDate ?? ""}:${issue.shiftType ?? ""}:${issue.message}:${issue.missingCount ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function parseManagerReviewRepairOptions(value: Json | unknown): ManagerReviewRepairOption[] {
  return asArray(value)
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }

      const shiftTypeRaw = getString(record, ["shift_type", "shiftType"]);

      return {
        shiftId: getString(record, ["shift_id", "shiftId"]),
        shiftDate: getString(record, ["shift_date", "date", "date_key"]),
        shiftType: isShiftType(shiftTypeRaw) ? shiftTypeRaw : null,
        hasRuleCleanCandidate: getBoolean(record, [
          "has_rule_clean_candidate",
          "hasRuleCleanCandidate",
          "rule_clean_candidate_exists",
        ]),
        recommendedCandidateCount: getNumber(record, [
          "recommended_candidate_count",
          "recommendedCandidateCount",
          "candidate_count",
        ]),
        topBlockedCandidates: parseManagerReviewCandidates(
          record.top_blocked_candidates ?? record.blocked_candidates ?? record.top_candidates ?? [],
        ),
      } satisfies ManagerReviewRepairOption;
    })
    .filter((entry): entry is ManagerReviewRepairOption => entry !== null);
}

export function getManagerReview(metadata: unknown): ManagerReview | null {
  const metadataRecord = asRecord(metadata);
  if (!metadataRecord) {
    return null;
  }

  const reviewRecord = asRecord(metadataRecord.manager_review);
  if (!reviewRecord) {
    return null;
  }

  return {
    status: getString(reviewRecord, ["status"]),
    headline: getString(reviewRecord, ["headline"]),
    readyForCommit: getBoolean(reviewRecord, ["ready_for_commit", "readyForCommit"]),
    requiresHumanReview: getBoolean(reviewRecord, ["requires_human_review", "requiresHumanReview"]),
    summary: parseManagerReviewSummary(reviewRecord.summary),
    blockingIssues: parseManagerReviewBlockingIssues(reviewRecord.blocking_issues),
    repairOptions: parseManagerReviewRepairOptions(reviewRecord.repair_options),
    softWarnings: getStringList(reviewRecord.soft_warnings),
    humanReviewFlags: getStringList(reviewRecord.human_review_flags),
    nextActions: getStringList(reviewRecord.next_actions),
  };
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
  shift:
    | Pick<ShiftRow, "start_time" | "end_time">
    | { startTime: string | null; endTime: string | null },
) {
  const start = normalizeShiftTime("start_time" in shift ? shift.start_time : shift.startTime)?.slice(
    0,
    5,
  );
  const end = normalizeShiftTime("end_time" in shift ? shift.end_time : shift.endTime)?.slice(0, 5);

  if (start && end) {
    return `${start} - ${end}`;
  }

  if (start) {
    return `Starts ${start}`;
  }

  if (end) {
    return `Until ${end}`;
  }

  return "Time TBD";
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

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function getInclusivePeriodWeeks(startKey: string, endKey: string) {
  const start = parseDateOnly(startKey);
  const end = parseDateOnly(endKey);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay) + 1;
  return inclusiveDays / 7;
}

function parseTimeToMinutes(value: string | null | undefined) {
  const normalized = normalizeShiftTime(value);

  if (!normalized) {
    return null;
  }

  const [hours, minutes] = normalized.split(":").map(Number);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function getShiftDurationHours(shift: Pick<ShiftRow, "start_time" | "end_time">) {
  const startMinutes = parseTimeToMinutes(shift.start_time);
  const endMinutes = parseTimeToMinutes(shift.end_time);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }

  return (endMinutes - startMinutes) / 60;
}

export function buildScheduleBudgetSummary({
  selectedPeriod,
  activeStaff,
  contracts,
  shifts,
  assignments,
  activeLifecycle,
}: {
  selectedPeriod: SchedulePeriodRow;
  activeStaff: StaffMemberRow[];
  contracts: EmploymentContractRow[];
  shifts: ShiftRow[];
  assignments: ShiftAssignmentRow[];
  activeLifecycle: ScheduleAssignmentLifecycle | null;
}): ScheduleBudgetSummary {
  const monthlyBudgetEur = selectedPeriod.monthly_staff_budget_eur;
  const weeksInPeriod = getInclusivePeriodWeeks(selectedPeriod.start_date, selectedPeriod.end_date);
  const missingMinimumRequirementInputs: string[] = [];
  let minimumRequiredEur = 0;

  for (const staff of activeStaff) {
    const activeContract = findActiveContract(
      contracts.filter((contract) => contract.staff_id === staff.id),
      selectedPeriod.start_date,
    );

    if (!activeContract) {
      continue;
    }

    if (staff.hourly_rate === null) {
      missingMinimumRequirementInputs.push(`${staff.full_name} is missing an hourly rate.`);
      continue;
    }

    minimumRequiredEur +=
      activeContract.min_shifts_per_week *
      activeContract.standard_shift_hours *
      staff.hourly_rate *
      weeksInPeriod;
  }

  const relevantAssignments = assignments.filter(
    (assignment) =>
      assignment.status === "assigned" &&
      (activeLifecycle ? assignment.lifecycle === activeLifecycle : true),
  );
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
  const staffById = new Map(activeStaff.map((staff) => [staff.id, staff]));
  let estimatedAssignedSpendEur = 0;
  let canEstimateAssignedSpend = relevantAssignments.length > 0;

  for (const assignment of relevantAssignments) {
    const shift = shiftById.get(assignment.shift_id);
    const staff = staffById.get(assignment.staff_id);

    if (!shift || !staff || staff.hourly_rate === null) {
      canEstimateAssignedSpend = false;
      continue;
    }

    const shiftDurationHours = getShiftDurationHours(shift);

    if (shiftDurationHours === null) {
      canEstimateAssignedSpend = false;
      continue;
    }

    estimatedAssignedSpendEur += shiftDurationHours * staff.hourly_rate;
  }

  const normalizedMinimumRequiredEur =
    missingMinimumRequirementInputs.length > 0 ? null : roundCurrency(minimumRequiredEur);
  const normalizedAssignedSpendEur = canEstimateAssignedSpend
    ? roundCurrency(estimatedAssignedSpendEur)
    : null;
  const meetsMinimumRequirement =
    monthlyBudgetEur !== null && normalizedMinimumRequiredEur !== null
      ? monthlyBudgetEur >= normalizedMinimumRequiredEur
      : null;

  return {
    monthlyBudgetEur,
    minimumRequiredEur: normalizedMinimumRequiredEur,
    estimatedAssignedSpendEur: normalizedAssignedSpendEur,
    shortfallEur:
      monthlyBudgetEur !== null &&
      normalizedMinimumRequiredEur !== null &&
      monthlyBudgetEur < normalizedMinimumRequiredEur
        ? roundCurrency(normalizedMinimumRequiredEur - monthlyBudgetEur)
        : null,
    remainingEur:
      monthlyBudgetEur !== null && normalizedAssignedSpendEur !== null
        ? roundCurrency(monthlyBudgetEur - normalizedAssignedSpendEur)
        : null,
    meetsMinimumRequirement,
    missingMinimumRequirementInputs,
  };
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
  budget,
  shifts,
}: {
  selectedPeriod: SchedulePeriodRow;
  activeStaff: StaffMemberRow[];
  submissions: AvailabilitySubmissionRow[];
  contracts: EmploymentContractRow[];
  trainingRows: StaffTrainingStatusRow[];
  budget: ScheduleBudgetSummary;
  shifts: ShiftRow[];
}) {
  const today = selectedPeriod.start_date;
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
      status:
        budget.monthlyBudgetEur !== null &&
        budget.meetsMinimumRequirement === true &&
        budget.missingMinimumRequirementInputs.length === 0
          ? "ready"
          : "warning",
      summary:
        budget.monthlyBudgetEur === null
          ? "Monthly staffing budget not configured"
          : budget.missingMinimumRequirementInputs.length > 0
            ? "Budget can't be validated until hourly rates are complete"
            : budget.meetsMinimumRequirement
              ? `Budget set at €${budget.monthlyBudgetEur.toFixed(2)}`
              : "Budget does not meet everyone's minimum contract hours per week",
      details:
        budget.monthlyBudgetEur === null
          ? ["Add the monthly staffing budget in euros for this schedule period."]
          : budget.missingMinimumRequirementInputs.length > 0
            ? budget.missingMinimumRequirementInputs
            : budget.meetsMinimumRequirement === false
              ? [
                  `Minimum required spend is €${budget.minimumRequiredEur?.toFixed(2) ?? "0.00"} for this period.`,
                  `Current budget is short by €${budget.shortfallEur?.toFixed(2) ?? "0.00"}.`,
                ]
              : [
                  `Minimum required spend is €${budget.minimumRequiredEur?.toFixed(2) ?? "0.00"} for this period.`,
                ],
      blocking:
        budget.monthlyBudgetEur === null ||
        budget.meetsMinimumRequirement === false ||
        budget.missingMinimumRequirementInputs.length > 0,
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

function buildScheduleWeeks({
  selectedPeriod,
  shifts,
  assignments,
  staffById,
  assignmentLifecycle,
}: {
  selectedPeriod: SchedulePeriodRow;
  shifts: ShiftRow[];
  assignments: ShiftAssignmentRow[];
  staffById: Map<string, StaffMemberRow>;
  assignmentLifecycle: ScheduleAssignmentLifecycle | null;
}) {
  const relevantAssignments = assignments.filter(
    (assignment) =>
      assignment.status === "assigned" &&
      (assignmentLifecycle ? assignment.lifecycle === assignmentLifecycle : false),
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
        startTime: normalizeShiftTime(shift.start_time),
        endTime: normalizeShiftTime(shift.end_time),
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

function buildScheduleMetrics({
  coverageRows,
  contractRows,
  budget,
  shifts,
  assignments,
  activeLifecycle,
  validationIssues,
}: {
  coverageRows: DailyCoverageStatusRow[];
  contractRows: ContractPeriodProgressRow[];
  budget: ScheduleBudgetSummary;
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
    budgetUsed: budget.estimatedAssignedSpendEur,
    budgetLimit: budget.monthlyBudgetEur,
    issueCount: validationIssues.length,
  } satisfies ScheduleMetrics;
}

export function buildScheduleCreatorViewModel({
  selectedPeriod,
  activeStaff,
  submissions,
  contracts,
  trainingRows,
  shifts,
  assignments,
  generationRuns,
  validationIssues,
  coverageRows,
  contractRows,
}: {
  selectedPeriod: SchedulePeriodRow;
  activeStaff: StaffMemberRow[];
  submissions: AvailabilitySubmissionRow[];
  contracts: EmploymentContractRow[];
  trainingRows: StaffTrainingStatusRow[];
  shifts: ShiftRow[];
  assignments: ShiftAssignmentRow[];
  generationRuns: ScheduleGenerationRunRow[];
  validationIssues: ScheduleValidationIssue[];
  coverageRows: DailyCoverageStatusRow[];
  contractRows: ContractPeriodProgressRow[];
}) {
  const hasDraftSchedule = assignments.some(
    (assignment) => assignment.status === "assigned" && assignment.lifecycle === "draft",
  );
  const hasPublishedSchedule = assignments.some(
    (assignment) => assignment.status === "assigned" && assignment.lifecycle === "published",
  );
  const latestRunRow = generationRuns[0] ?? null;
  const managerReview = latestRunRow ? getManagerReview(latestRunRow.metadata) : null;
  const activeLifecycle: ScheduleAssignmentLifecycle | null = hasDraftSchedule
    ? "draft"
    : hasPublishedSchedule
      ? "published"
      : null;
  const needsDraftSave = managerReview !== null && !hasDraftSchedule;
  const budget = buildScheduleBudgetSummary({
    selectedPeriod,
    activeStaff,
    contracts,
    shifts,
    assignments,
    activeLifecycle,
  });
  const readiness = buildReadinessChecks({
    selectedPeriod,
    activeStaff,
    submissions,
    contracts,
    trainingRows,
    budget,
    shifts,
  });
  const weeks = buildScheduleWeeks({
    selectedPeriod,
    shifts,
    assignments,
    staffById: new Map(activeStaff.map((staff) => [staff.id, staff])),
    assignmentLifecycle: hasDraftSchedule ? "draft" : null,
  });
  const effectiveValidationIssues = needsDraftSave ? [] : validationIssues;
  const metrics = buildScheduleMetrics({
    coverageRows,
    contractRows,
    budget,
    shifts,
    assignments,
    activeLifecycle,
    validationIssues: effectiveValidationIssues,
  });
  const latestRun = latestRunRow
    ? (() => {
        const isManagerReviewRequired =
          latestRunRow.status === "failed" &&
          latestRunRow.current_stage === "manager_review_required" &&
          managerReview !== null;

        return {
          id: latestRunRow.id,
          status: latestRunRow.status,
          statusLabel: isManagerReviewRequired
            ? "Manager review required"
            : statusLabel(latestRunRow.status),
          currentStage: latestRunRow.current_stage,
          startedAt: latestRunRow.started_at,
          completedAt: latestRunRow.completed_at,
          failedAt: latestRunRow.failed_at,
          failureMessage: isManagerReviewRequired ? null : latestRunRow.failure_message,
          managerReview,
        } satisfies ScheduleGenerationRunSummary;
      })()
    : null;

  return {
    readiness,
    budget,
    metrics,
    latestRun,
    validationIssues: effectiveValidationIssues,
    weeks,
    activeLifecycle,
    hasDraftSchedule,
    hasPublishedSchedule,
    needsDraftSave,
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
      !needsDraftSave &&
      (managerReview?.readyForCommit !== false || managerReview === null) &&
      effectiveValidationIssues.every((issue) => issue.severity !== "block") &&
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
      "id, name, start_date, end_date, availability_deadline, monthly_staff_budget_eur, status, published_at, created_by, created_at, updated_at",
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
