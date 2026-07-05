import { formatRoleLabel } from "@/lib/admin/staff";
import type {
  AvailabilityDayRow,
  AvailabilitySubmissionRow,
  AvailabilityUnavailableStreakRow,
  SchedulePeriodRow,
  SchedulingSettingsRow,
  ShiftType,
  StaffMemberRow,
  WorkRole,
} from "@/lib/supabase/types";

export type AvailabilityStatus = "submitted" | "draft" | "not_started";
export type CoverageStatus = "risk" | "tight" | "good";
export type CoverageFilter = "all" | "tight_and_risk" | "risk_only";

export type AvailabilityDayValue = {
  morning: boolean;
  day: boolean;
  evening: boolean;
};

export type StaffAvailabilityRecord = {
  staffId: string;
  fullName: string;
  workRole: WorkRole;
  schedulingRuleRole: WorkRole;
  submissionStatus: AvailabilityStatus;
  willingToWorkAboveTarget: boolean;
  maxExtraShiftsForPeriod: number | null;
  submittedAt: string | null;
  days: Record<string, AvailabilityDayValue>;
};

export type AvailabilitySummary = {
  submittedCount: number;
  totalActiveStaff: number;
  pendingCount: number;
  holidayPeriodsCount: number;
  extraShiftStaffCount: number;
};

export type WeekSlice = {
  id: string;
  startKey: string;
  endKey: string;
  dateKeys: string[];
};

export type TeamAvailabilityViewModel = {
  summary: AvailabilitySummary;
  holidayThreshold: number;
  coverageRequirements: {
    morning: number;
    evening: number;
  };
  staffRecords: StaffAvailabilityRecord[];
};

export const SHIFT_ORDER: ShiftType[] = ["morning", "day", "evening"];

export function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeekMonday(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

export function getWeekSlices(startKey: string, endKey: string) {
  const start = parseDateOnly(startKey);
  const end = parseDateOnly(endKey);
  const weeks = new Map<string, string[]>();

  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const dateKey = formatDateKey(cursor);
    const weekKey = formatDateKey(startOfWeekMonday(cursor));
    const existing = weeks.get(weekKey) ?? [];
    existing.push(dateKey);
    weeks.set(weekKey, existing);
  }

  return Array.from(weeks.entries()).map(([id, dateKeys]) => ({
    id,
    startKey: dateKeys[0],
    endKey: dateKeys[dateKeys.length - 1],
    dateKeys,
  }));
}

export function formatPeriodHeading(period: Pick<SchedulePeriodRow, "name">) {
  return period.name.toUpperCase();
}

export function formatPeriodOptionLabel(period: Pick<SchedulePeriodRow, "name" | "start_date">) {
  if (period.name.trim()) {
    return period.name;
  }

  return formatMonthYear(period.start_date);
}

export function formatMonthYear(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(parseDateOnly(dateKey));
}

export function formatWeekLabel(startKey: string, endKey: string) {
  const start = parseDateOnly(startKey);
  const end = parseDateOnly(endKey);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();

  if (sameMonth) {
    const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(start);
    return `${month} ${start.getDate()}-${end.getDate()}`;
  }

  return `${formatReadableDate(startKey)}-${formatReadableDate(endKey)}`;
}

export function formatReadableDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parseDateOnly(dateKey));
}

export function formatLongDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(parseDateOnly(dateKey));
}

export function formatWeekday(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(parseDateOnly(dateKey));
}

export function formatDayNumber(dateKey: string) {
  return String(parseDateOnly(dateKey).getDate());
}

export function getDefaultPeriodId(periods: SchedulePeriodRow[], todayKey = formatDateKey(new Date())) {
  const current = periods.find((period) => period.start_date <= todayKey && period.end_date >= todayKey);

  if (current) {
    return current.id;
  }

  const upcoming = periods
    .filter((period) => period.start_date >= todayKey)
    .sort((left, right) => left.start_date.localeCompare(right.start_date))[0];

  if (upcoming) {
    return upcoming.id;
  }

  return [...periods].sort((left, right) => right.created_at.localeCompare(left.created_at))[0]?.id ?? null;
}

export function buildTeamAvailabilityViewModel({
  activeStaff,
  submissions,
  availabilityDays,
  unavailableStreaks,
  settings,
}: {
  activeStaff: StaffMemberRow[];
  submissions: AvailabilitySubmissionRow[];
  availabilityDays: AvailabilityDayRow[];
  unavailableStreaks: AvailabilityUnavailableStreakRow[];
  settings: SchedulingSettingsRow | null;
}) {
  const submissionByStaffId = new Map(submissions.map((submission) => [submission.staff_id, submission]));
  const daysBySubmissionId = new Map<string, Record<string, AvailabilityDayValue>>();

  for (const day of availabilityDays) {
    const existing = daysBySubmissionId.get(day.submission_id) ?? {};
    existing[day.available_date] = {
      morning: day.morning,
      day: day.day,
      evening: day.evening,
    };
    daysBySubmissionId.set(day.submission_id, existing);
  }

  const staffRecords = activeStaff
    .map<StaffAvailabilityRecord>((staff) => {
      const submission = submissionByStaffId.get(staff.id);
      const submissionStatus: AvailabilityStatus = submission
        ? submission.status === "submitted"
          ? "submitted"
          : "draft"
        : "not_started";

      return {
        staffId: staff.id,
        fullName: staff.full_name,
        workRole: staff.work_role,
        schedulingRuleRole: staff.scheduling_rule_role,
        submissionStatus,
        willingToWorkAboveTarget: submission?.willing_to_work_above_target ?? false,
        maxExtraShiftsForPeriod: submission?.max_extra_shifts_for_period ?? null,
        submittedAt: submission?.submitted_at ?? null,
        days: submission ? daysBySubmissionId.get(submission.id) ?? {} : {},
      };
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));

  const submittedCount = staffRecords.filter((record) => record.submissionStatus === "submitted").length;
  const totalActiveStaff = activeStaff.length;
  const pendingCount = totalActiveStaff - submittedCount;
  const holidayThreshold = settings?.holiday_streak_days ?? 14;
  const activeStaffIds = new Set(activeStaff.map((staff) => staff.id));
  const holidayPeriodsCount = unavailableStreaks.filter(
    (streak) => activeStaffIds.has(streak.staff_id) && streak.streak_days >= holidayThreshold,
  ).length;
  const extraShiftStaffCount = staffRecords.filter(
    (record) => record.submissionStatus === "submitted" && record.willingToWorkAboveTarget,
  ).length;

  return {
    summary: {
      submittedCount,
      totalActiveStaff,
      pendingCount,
      holidayPeriodsCount,
      extraShiftStaffCount,
    },
    holidayThreshold,
    coverageRequirements: {
      morning: settings?.min_morning_coverage ?? 1,
      evening: settings?.min_evening_coverage ?? 1,
    },
    staffRecords,
  } satisfies TeamAvailabilityViewModel;
}

export function getCoverageStatus(
  shiftType: ShiftType,
  availableCount: number,
  requirements: { morning: number; evening: number },
): CoverageStatus {
  if (shiftType === "day") {
    if (availableCount <= 0) {
      return "risk";
    }

    if (availableCount === 1) {
      return "tight";
    }

    return "good";
  }

  const required = shiftType === "morning" ? requirements.morning : requirements.evening;

  if (availableCount <= required) {
    return "risk";
  }

  if (availableCount === required + 1) {
    return "tight";
  }

  return "good";
}

export function getCoverageStatusLabel(status: CoverageStatus) {
  if (status === "risk") {
    return "Risk";
  }

  if (status === "tight") {
    return "Tight";
  }

  return "Good";
}

export function getStatusBadgeLabel(status: AvailabilityStatus) {
  if (status === "submitted") {
    return "Submitted";
  }

  if (status === "draft") {
    return "Draft";
  }

  return "Not started";
}

export function formatSubmittedAt(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatShiftAvailabilityCell(
  dayValue: AvailabilityDayValue | undefined,
  submissionStatus: AvailabilityStatus,
) {
  if (!dayValue) {
    return submissionStatus === "not_started" ? "Not submitted" : "—";
  }

  const labels = SHIFT_ORDER.filter((shift) => dayValue[shift]).map((shift) =>
    shift === "morning" ? "M" : shift === "day" ? "D" : "E",
  );

  if (labels.length === 0) {
    return "—";
  }

  return labels.join(" ");
}

export function getShiftLabel(shift: ShiftType) {
  return shift === "morning" ? "Morning" : shift === "day" ? "Day" : "Evening";
}

export function getShiftShortLabel(shift: ShiftType) {
  return shift === "morning" ? "M" : shift === "day" ? "D" : "E";
}

export function getRoleSummary(record: Pick<StaffAvailabilityRecord, "workRole" | "schedulingRuleRole">) {
  return `${formatRoleLabel(record.workRole)} · Rule ${formatRoleLabel(record.schedulingRuleRole)}`;
}
