"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShiftAvailabilityDrawer } from "@/components/admin/availability/shift-availability-drawer";
import {
  formatDateKey,
  formatDayNumber,
  formatMonthYear,
  formatPeriodHeading,
  formatPeriodOptionLabel,
  formatReadableDate,
  formatShiftAvailabilityCell,
  formatSubmittedAt,
  formatWeekLabel,
  formatWeekday,
  getCoverageStatus,
  getCoverageStatusLabel,
  getRoleSummary,
  getShiftLabel,
  getStatusBadgeLabel,
  getWeekSlices,
  SHIFT_ORDER,
  type AvailabilityStatus,
  type CoverageFilter,
  type StaffAvailabilityRecord,
  type TeamAvailabilityViewModel,
} from "@/lib/admin/availability";
import type { SchedulePeriodRow, ShiftType } from "@/lib/supabase/types";

type AvailabilityDashboardProps = {
  periods: SchedulePeriodRow[];
  selectedPeriod: SchedulePeriodRow;
  model: TeamAvailabilityViewModel;
};

type ViewMode = "coverage" | "staff";

type DrawerState = {
  dateKey: string;
  shift: ShiftType;
} | null;

function statusToneClasses(status: "risk" | "tight" | "good") {
  if (status === "risk") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (status === "tight") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function trackerBadgeClasses(status: AvailabilityStatus) {
  if (status === "submitted") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (status === "draft") {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-slate-100 text-slate-600";
}

function summaryCardTone(key: "submitted" | "pending" | "holiday" | "extra") {
  if (key === "submitted") {
    return "text-emerald-700";
  }

  if (key === "pending") {
    return "text-amber-700";
  }

  if (key === "holiday") {
    return "text-sky-700";
  }

  return "text-slate-950";
}

function getInitialWeekIndex(weeks: ReturnType<typeof getWeekSlices>, period: SchedulePeriodRow) {
  const todayKey = formatDateKey(new Date());
  const currentWeekIndex = weeks.findIndex(
    (week) => week.startKey <= todayKey && week.endKey >= todayKey,
  );

  if (todayKey >= period.start_date && todayKey <= period.end_date && currentWeekIndex >= 0) {
    return currentWeekIndex;
  }

  return 0;
}

export function AvailabilityDashboard({
  periods,
  selectedPeriod,
  model,
}: AvailabilityDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startNavigation] = useTransition();
  const [viewMode, setViewMode] = useState<ViewMode>("coverage");
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>("all");
  const [drawerState, setDrawerState] = useState<DrawerState>(null);

  const weeks = useMemo(
    () => getWeekSlices(selectedPeriod.start_date, selectedPeriod.end_date),
    [selectedPeriod.end_date, selectedPeriod.start_date],
  );
  const [weekIndex, setWeekIndex] = useState(() => getInitialWeekIndex(weeks, selectedPeriod));

  const visibleWeek = weeks[weekIndex] ?? null;

  const coverageDays = useMemo(() => {
    if (!visibleWeek) {
      return [];
    }

    return visibleWeek.dateKeys.map((dateKey) => {
      const shifts = SHIFT_ORDER.map((shift) => {
        const availableCount = model.staffRecords.reduce((count, record) => {
          return count + Number(record.submissionStatus === "submitted" && record.days[dateKey]?.[shift] === true);
        }, 0);

        const status = getCoverageStatus(shift, availableCount, model.coverageRequirements);

        return {
          shift,
          availableCount,
          status,
        };
      });

      return {
        dateKey,
        shifts,
      };
    });
  }, [model.coverageRequirements, model.staffRecords, visibleWeek]);

  const filteredCoverageDays = useMemo(() => {
    return coverageDays.filter((day) => {
      if (coverageFilter === "all") {
        return true;
      }

      const statuses = day.shifts.map((shift) => shift.status);

      if (coverageFilter === "risk_only") {
        return statuses.includes("risk");
      }

      return statuses.some((status) => status === "risk" || status === "tight");
    });
  }, [coverageDays, coverageFilter]);

  const drawerDetail = useMemo(() => {
    if (!drawerState) {
      return null;
    }

    const available = model.staffRecords.filter(
      (record) =>
        record.submissionStatus === "submitted" &&
        record.days[drawerState.dateKey]?.[drawerState.shift] === true,
    );
    const unavailable = model.staffRecords.filter((record) => {
      if (record.submissionStatus !== "submitted") {
        return false;
      }

      return record.days[drawerState.dateKey]?.[drawerState.shift] !== true;
    });
    const notSubmitted = model.staffRecords.filter(
      (record) => record.submissionStatus === "draft" || record.submissionStatus === "not_started",
    );

    const availableCount = available.length;
    const status = getCoverageStatus(drawerState.shift, availableCount, model.coverageRequirements);

    return {
      ...drawerState,
      available,
      unavailable,
      notSubmitted,
      availableCount,
      status,
    };
  }, [drawerState, model.coverageRequirements, model.staffRecords]);

  const noSubmissionMessage =
    model.summary.submittedCount === 0
      ? "No availability has been submitted for this period yet."
      : null;
  const pendingMessage =
    model.summary.pendingCount > 0
      ? `${model.summary.pendingCount} staff member${
          model.summary.pendingCount === 1 ? " has" : "s have"
        } not submitted availability yet.`
      : null;

  function handlePeriodChange(periodId: string) {
    startNavigation(() => {
      router.push(`${pathname}?period=${periodId}`);
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">
              {formatPeriodHeading(selectedPeriod)} Availability
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance text-slate-950 sm:text-5xl">
              Team Availability
            </h1>
            <p className="text-sm leading-7 text-slate-600 sm:text-base">
              See who has submitted, where coverage is tight, and which staff are available for each shift.
            </p>
          </div>

          <div className="w-full max-w-sm">
            <label
              htmlFor="period-select"
              className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500"
            >
              Schedule period
            </label>
            <select
              id="period-select"
              value={selectedPeriod.id}
              onChange={(event) => handlePeriodChange(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              disabled={isNavigating}
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {formatPeriodOptionLabel(period)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Submitted
          </p>
          <p className={["mt-3 text-4xl font-semibold tracking-tight", summaryCardTone("submitted")].join(" ")}>
            {model.summary.submittedCount} / {model.summary.totalActiveStaff}
          </p>
        </article>
        <article className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Pending
          </p>
          <p className={["mt-3 text-4xl font-semibold tracking-tight", summaryCardTone("pending")].join(" ")}>
            {model.summary.pendingCount}
          </p>
        </article>
        <article className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Holiday periods
          </p>
          <p className={["mt-3 text-4xl font-semibold tracking-tight", summaryCardTone("holiday")].join(" ")}>
            {model.summary.holidayPeriodsCount}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {model.holidayThreshold}+ fully unavailable days
          </p>
        </article>
        <article className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Extra shifts
          </p>
          <p className={["mt-3 text-4xl font-semibold tracking-tight", summaryCardTone("extra")].join(" ")}>
            {model.summary.extraShiftStaffCount}
          </p>
          <p className="mt-2 text-xs text-slate-500">staff available</p>
        </article>
      </section>

      {noSubmissionMessage || pendingMessage ? (
        <section className="rounded-[1.6rem] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          {noSubmissionMessage ?? pendingMessage}
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
              Submission status
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Can scheduling begin?
            </h2>
          </div>
          <p className="text-sm leading-6 text-slate-500">
            {model.summary.submittedCount} of {model.summary.totalActiveStaff} active staff have submitted.
          </p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {model.staffRecords.map((record) => (
            <article
              key={record.staffId}
              className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950">{record.fullName}</p>
                  <p className="mt-1 text-xs text-slate-500">{getRoleSummary(record)}</p>
                </div>
                <span
                  className={[
                    "rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em]",
                    trackerBadgeClasses(record.submissionStatus),
                  ].join(" ")}
                >
                  {getStatusBadgeLabel(record.submissionStatus)}
                </span>
              </div>

              <div className="mt-4 space-y-1 text-xs text-slate-500">
                {record.submissionStatus === "submitted" && record.submittedAt ? (
                  <p>Submitted {formatSubmittedAt(record.submittedAt)}</p>
                ) : null}
                {record.willingToWorkAboveTarget ? (
                  <p>
                    Extra shifts:{" "}
                    {record.maxExtraShiftsForPeriod === null
                      ? "willing to help above target"
                      : `up to ${record.maxExtraShiftsForPeriod} this period`}
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
            {([
              { key: "coverage", label: "Coverage View" },
              { key: "staff", label: "Staff View" },
            ] as const).map((view) => (
              <button
                key={view.key}
                type="button"
                onClick={() => setViewMode(view.key)}
                className={[
                  "rounded-[1rem] px-4 py-2 text-sm font-semibold transition",
                  viewMode === view.key
                    ? "bg-slate-950 text-white shadow-[0_10px_30px_rgba(15,23,42,0.15)]"
                    : "text-slate-600 hover:text-slate-950",
                ].join(" ")}
              >
                {view.label}
              </button>
            ))}
          </div>

          {visibleWeek ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setWeekIndex((current) => Math.max(current - 1, 0))}
                disabled={weekIndex === 0}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous week
              </button>
              <div className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-900">
                {formatWeekLabel(visibleWeek.startKey, visibleWeek.endKey)}
              </div>
              <button
                type="button"
                onClick={() => setWeekIndex((current) => Math.min(current + 1, weeks.length - 1))}
                disabled={weekIndex === weeks.length - 1}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next week
              </button>
            </div>
          ) : null}
        </div>

        {viewMode === "coverage" ? (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {([
                { key: "all", label: "All days" },
                { key: "tight_and_risk", label: "Tight + Risk" },
                { key: "risk_only", label: "Risk only" },
              ] as const).map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setCoverageFilter(filter.key)}
                  className={[
                    "rounded-full border px-3 py-2 text-sm font-medium transition",
                    coverageFilter === filter.key
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950",
                  ].join(" ")}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {filteredCoverageDays.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 px-5 py-6 text-sm text-slate-500">
                No days match the current filter for {formatMonthYear(selectedPeriod.start_date)}.
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredCoverageDays.map((day) => (
                  <article
                    key={day.dateKey}
                    className="rounded-[1.75rem] border border-slate-200 bg-slate-50/70 p-5"
                  >
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                          {formatWeekday(day.dateKey)}
                        </p>
                        <h3 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                          {formatDayNumber(day.dateKey)}
                        </h3>
                      </div>
                      <p className="text-sm font-medium text-slate-500">
                        {formatReadableDate(day.dateKey)}
                      </p>
                    </div>

                    <div className="mt-5 space-y-3">
                      {day.shifts.map((shiftInfo) => (
                        <button
                          key={shiftInfo.shift}
                          type="button"
                          onClick={() => setDrawerState({ dateKey: day.dateKey, shift: shiftInfo.shift })}
                          className="flex w-full items-center justify-between rounded-[1.25rem] border border-white/70 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-950">
                              {getShiftLabel(shiftInfo.shift)}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              {shiftInfo.availableCount} available
                            </p>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="hidden items-center gap-1 sm:flex">
                              {Array.from({ length: shiftInfo.availableCount }).map((_, index) => (
                                <span
                                  key={index}
                                  aria-hidden="true"
                                  className={[
                                    "h-2.5 w-2.5 rounded-full",
                                    shiftInfo.status === "risk"
                                      ? "bg-rose-400"
                                      : shiftInfo.status === "tight"
                                        ? "bg-amber-400"
                                        : "bg-emerald-400",
                                  ].join(" ")}
                                />
                              ))}
                            </div>
                            <span
                              className={[
                                "rounded-full border px-3 py-1 text-sm font-medium",
                                statusToneClasses(shiftInfo.status),
                              ].join(" ")}
                            >
                              {getCoverageStatusLabel(shiftInfo.status)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="font-semibold text-slate-900">Legend</span>
              <span>M = Morning</span>
              <span>D = Day</span>
              <span>E = Evening</span>
              <span>— = Unavailable</span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                Draft
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                Not started
              </span>
            </div>

            <div className="overflow-x-auto">
              <div
                className="grid min-w-[860px] gap-3"
                style={{
                  gridTemplateColumns: `minmax(220px, 1.6fr) repeat(${visibleWeek?.dateKeys.length ?? 0}, minmax(92px, 1fr))`,
                }}
              >
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Staff
                </div>
                {visibleWeek?.dateKeys.map((dateKey) => (
                  <div
                    key={dateKey}
                    className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                  >
                    <div>{formatWeekday(dateKey)}</div>
                    <div className="mt-1 text-sm font-semibold normal-case text-slate-700">
                      {formatReadableDate(dateKey)}
                    </div>
                  </div>
                ))}

                {model.staffRecords.map((record) => (
                  <FragmentStaffRow
                    key={record.staffId}
                    record={record}
                    dateKeys={visibleWeek?.dateKeys ?? []}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {drawerDetail ? (
        <ShiftAvailabilityDrawer
          dateKey={drawerDetail.dateKey}
          shift={drawerDetail.shift}
          available={drawerDetail.available}
          unavailable={drawerDetail.unavailable}
          notSubmitted={drawerDetail.notSubmitted}
          availableCount={drawerDetail.availableCount}
          statusLabel={getCoverageStatusLabel(drawerDetail.status)}
          statusTone={drawerDetail.status}
          onClose={() => setDrawerState(null)}
        />
      ) : null}
    </div>
  );
}

function FragmentStaffRow({
  record,
  dateKeys,
}: {
  record: StaffAvailabilityRecord;
  dateKeys: string[];
}) {
  return (
    <>
      <div className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">{record.fullName}</p>
            <p className="mt-1 text-xs text-slate-500">{getRoleSummary(record)}</p>
          </div>
          <span
            className={[
              "rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em]",
              trackerBadgeClasses(record.submissionStatus),
            ].join(" ")}
          >
            {getStatusBadgeLabel(record.submissionStatus)}
          </span>
        </div>
      </div>

      {dateKeys.map((dateKey) => {
        const cellValue = formatShiftAvailabilityCell(record.days[dateKey], record.submissionStatus);
        const isDraft = record.submissionStatus === "draft";
        const isNotStarted = record.submissionStatus === "not_started";

        return (
          <div
            key={`${record.staffId}-${dateKey}`}
            className={[
              "flex min-h-[88px] items-center justify-center rounded-[1.4rem] border px-3 py-3 text-center",
              isNotStarted
                ? "border-slate-200 bg-slate-50 text-slate-400"
                : isDraft
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-white text-slate-900",
            ].join(" ")}
          >
            <span className={isNotStarted ? "text-xs font-medium" : "text-sm font-semibold"}>
              {cellValue}
            </span>
          </div>
        );
      })}
    </>
  );
}
