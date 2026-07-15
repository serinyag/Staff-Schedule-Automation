"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  publishSchedulePeriodAction,
  queueScheduleGenerationAction,
} from "@/app/(authenticated)/admin/schedule/actions";
import { INITIAL_SCHEDULE_MUTATION_STATE } from "@/app/(authenticated)/admin/schedule/action-state";
import { ScheduleBudgetPanel } from "@/components/admin/schedule/schedule-budget-panel";
import { ScheduleEditDrawer } from "@/components/admin/schedule/schedule-edit-drawer";
import { formatCurrency } from "@/lib/admin/staff";
import {
  formatSchedulePeriodHeading,
  formatSchedulePeriodOptionLabel,
  formatScheduleStatusLabel,
  formatShiftTimeRange,
  type ScheduleCreatorViewModel,
  type ScheduleShiftView,
} from "@/lib/admin/schedule";
import type { SchedulePeriodRow } from "@/lib/supabase/types";
import type { ScheduleDrawerData } from "@/components/admin/schedule/schedule-edit-drawer";

type ScheduleDashboardProps = {
  periods: SchedulePeriodRow[];
  selectedPeriod: SchedulePeriodRow;
  model: ScheduleCreatorViewModel;
};

function readinessTone(status: "ready" | "warning") {
  return status === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function issueTone(severity: "block" | "warning") {
  return severity === "block"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function metricValue(value: number | null, suffix = "") {
  if (value === null) {
    return "—";
  }

  return `${value}${suffix}`;
}

function formatNullableBoolean(value: boolean | null) {
  if (value === null) {
    return "—";
  }

  return value ? "Yes" : "No";
}

function formatManagerReviewShiftType(value: string | null) {
  if (!value) {
    return "—";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatBlockedCandidateLabel(staffName: string | null) {
  return staffName?.trim() ? staffName : "Unknown candidate";
}

function parseScheduleDateKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`);
}

function addCalendarDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatScheduleDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCalendarWeekStart(date: Date) {
  return addCalendarDays(date, -((date.getDay() + 6) % 7));
}

function getCalendarWeekEnd(date: Date) {
  return addCalendarDays(date, 6 - ((date.getDay() + 6) % 7));
}

function shiftTone(shift: ScheduleShiftView) {
  if (shift.assignments.length === 0) {
    return "border-rose-200 bg-rose-50 text-rose-950 hover:border-rose-300 hover:bg-rose-50";
  }

  if (shift.assignments.length < shift.requiredCount) {
    return "border-slate-300 bg-slate-100 text-slate-900 hover:border-slate-400 hover:bg-slate-100";
  }

  return "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-slate-100";
}

function formatShiftTypeLabel(value: ScheduleShiftView["shiftType"]) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const STAFF_PILL_PALETTE = [
  { backgroundColor: "#fef3c7", borderColor: "#f59e0b", color: "#78350f" },
  { backgroundColor: "#dbeafe", borderColor: "#3b82f6", color: "#1e3a8a" },
  { backgroundColor: "#e9d5ff", borderColor: "#8b5cf6", color: "#581c87" },
  { backgroundColor: "#dcfce7", borderColor: "#22c55e", color: "#14532d" },
  { backgroundColor: "#fee2e2", borderColor: "#ef4444", color: "#7f1d1d" },
  { backgroundColor: "#fde68a", borderColor: "#f97316", color: "#7c2d12" },
  { backgroundColor: "#cffafe", borderColor: "#06b6d4", color: "#164e63" },
  { backgroundColor: "#fbcfe8", borderColor: "#ec4899", color: "#831843" },
  { backgroundColor: "#e0e7ff", borderColor: "#6366f1", color: "#312e81" },
  { backgroundColor: "#d1fae5", borderColor: "#10b981", color: "#065f46" },
  { backgroundColor: "#ffedd5", borderColor: "#ea580c", color: "#7c2d12" },
  { backgroundColor: "#ede9fe", borderColor: "#7c3aed", color: "#4c1d95" },
  { backgroundColor: "#fef9c3", borderColor: "#eab308", color: "#713f12" },
  { backgroundColor: "#dbeafe", borderColor: "#0ea5e9", color: "#0c4a6e" },
  { backgroundColor: "#fae8ff", borderColor: "#d946ef", color: "#86198f" },
  { backgroundColor: "#ccfbf1", borderColor: "#14b8a6", color: "#134e4a" },
];

function getShiftTimeLabel(shift: Pick<ScheduleShiftView, "startTime" | "endTime">) {
  const label = formatShiftTimeRange(shift);
  return label === "Time TBD" ? null : label;
}

type DraggedAssignment = {
  assignmentId: string;
  fromShiftId: string;
  staffId: string;
  staffName: string;
};

export function ScheduleDashboard({
  periods,
  selectedPeriod,
  model,
}: ScheduleDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startNavigation] = useTransition();
  const [selectedShift, setSelectedShift] = useState<ScheduleShiftView | null>(null);
  const [generationState, generationAction, isGenerating] = useActionState(
    queueScheduleGenerationAction,
    INITIAL_SCHEDULE_MUTATION_STATE,
  );
  const [publishState, publishAction, isPublishing] = useActionState(
    publishSchedulePeriodAction,
    INITIAL_SCHEDULE_MUTATION_STATE,
  );
  const [drawerData, setDrawerData] = useState<ScheduleDrawerData | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [draggedAssignment, setDraggedAssignment] = useState<DraggedAssignment | null>(null);
  const [dropTargetShiftId, setDropTargetShiftId] = useState<string | null>(null);
  const [moveState, setMoveState] = useState<{
    status: "idle" | "success" | "error";
    message: string;
  }>({
    status: "idle",
    message: "",
  });
  const [isMovingAssignment, setIsMovingAssignment] = useState(false);
  const [shiftMutationState, setShiftMutationState] = useState<{
    status: "idle" | "success" | "error";
    message: string;
  }>({
    status: "idle",
    message: "",
  });
  const [pendingShiftMutationKey, setPendingShiftMutationKey] = useState<string | null>(null);

  const managerReview = model.latestRun?.managerReview ?? null;
  const groupedIssues = useMemo(
    () => ({
      block: model.validationIssues.filter((issue) => issue.severity === "block"),
      warning: model.validationIssues.filter((issue) => issue.severity === "warning"),
    }),
    [model.validationIssues],
  );
  const calendarWeeks = useMemo(() => {
    const daysByKey = new Map(
      model.weeks.flatMap((week) => week.shiftsByDate).map((day) => [day.dateKey, day]),
    );
    const periodStart = parseScheduleDateKey(selectedPeriod.start_date);
    const periodEnd = parseScheduleDateKey(selectedPeriod.end_date);
    const gridStart = getCalendarWeekStart(periodStart);
    const gridEnd = getCalendarWeekEnd(periodEnd);
    const weeks: Array<
      Array<{
        dateKey: string;
        date: Date;
        inPeriod: boolean;
        shifts: ScheduleShiftView[];
      }>
    > = [];

    let cursor = gridStart;
    while (cursor <= gridEnd) {
      const week: Array<{
        dateKey: string;
        date: Date;
        inPeriod: boolean;
        shifts: ScheduleShiftView[];
      }> = [];

      for (let index = 0; index < 7; index += 1) {
        const currentDate = addCalendarDays(cursor, index);
        const dateKey = formatScheduleDateKey(currentDate);
        const day = daysByKey.get(dateKey);
        week.push({
          dateKey,
          date: currentDate,
          inPeriod: dateKey >= selectedPeriod.start_date && dateKey <= selectedPeriod.end_date,
          shifts: day?.shifts ?? [],
        });
      }

      weeks.push(week);
      cursor = addCalendarDays(cursor, 7);
    }

    return weeks;
  }, [model.weeks, selectedPeriod.end_date, selectedPeriod.start_date]);
  const isDraftEditable =
    selectedPeriod.status !== "published" && selectedPeriod.status !== "locked";
  const staffPillStyles = useMemo(() => {
    const uniqueStaffIds = Array.from(
      new Set(
        model.weeks.flatMap((week) =>
          week.shiftsByDate.flatMap((day) =>
            day.shifts.flatMap((shift) => shift.assignments.map((assignment) => assignment.staffId)),
          ),
        ),
      ),
    ).sort((left, right) => left.localeCompare(right));

    return new Map(
      uniqueStaffIds.map((staffId, index) => [staffId, STAFF_PILL_PALETTE[index % STAFF_PILL_PALETTE.length]]),
    );
  }, [model.weeks]);

  async function loadDrawerData(nextShift: ScheduleShiftView) {
    setSelectedShift(nextShift);
    setDrawerLoading(true);
    setDrawerError(null);

    try {
      const response = await fetch(`/api/admin/schedule/shifts/${nextShift.id}/candidates`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(errorPayload?.message ?? `Candidates returned ${response.status}`);
      }

      const payload = (await response.json()) as ScheduleDrawerData;
      setDrawerData(payload);
    } catch (error) {
      setDrawerData(null);
      setDrawerError(
        error instanceof Error
          ? error.message
          : "Shift candidates could not be loaded right now.",
      );
    } finally {
      setDrawerLoading(false);
    }
  }

  function handlePeriodChange(periodId: string) {
    startNavigation(() => {
      router.push(`${pathname}?period=${periodId}`);
    });
  }

  async function moveAssignment(targetShift: ScheduleShiftView) {
    if (!draggedAssignment || isMovingAssignment) {
      return;
    }

    if (draggedAssignment.fromShiftId === targetShift.id) {
      setDropTargetShiftId(null);
      setDraggedAssignment(null);
      return;
    }

    setIsMovingAssignment(true);
    setMoveState({ status: "idle", message: "" });

    try {
      const response = await fetch("/api/admin/schedule/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "move",
          periodId: selectedPeriod.id,
          assignmentId: draggedAssignment.assignmentId,
          targetShiftId: targetShift.id,
        }),
      });

      const responsePayload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      const message =
        responsePayload?.message ??
        `We couldn't move ${draggedAssignment.staffName} to ${formatShiftTypeLabel(targetShift.shiftType)} on ${targetShift.dateKey}.`;

      if (!response.ok) {
        setMoveState({ status: "error", message });
        window.alert(message);
        return;
      }

      setMoveState({ status: "success", message });
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The assignment could not be moved right now. Please try again.";
      setMoveState({ status: "error", message });
      window.alert(message);
    } finally {
      setIsMovingAssignment(false);
      setDropTargetShiftId(null);
      setDraggedAssignment(null);
    }
  }

  async function createDayShift(dateKey: string) {
    if (!isDraftEditable || pendingShiftMutationKey) {
      return;
    }

    setPendingShiftMutationKey(`create:${dateKey}`);
    setShiftMutationState({ status: "idle", message: "" });

    try {
      const response = await fetch("/api/admin/schedule/shifts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "create",
          periodId: selectedPeriod.id,
          dateKey,
          shiftType: "day",
        }),
      });

      const responsePayload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      const message = responsePayload?.message ?? "Day shift updated.";

      if (!response.ok) {
        setShiftMutationState({ status: "error", message });
        return;
      }

      setShiftMutationState({ status: "success", message });
      router.refresh();
    } catch (error) {
      setShiftMutationState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The day shift could not be created right now. Please try again.",
      });
    } finally {
      setPendingShiftMutationKey(null);
    }
  }

  async function removeDayShift(shiftId: string) {
    if (!isDraftEditable || pendingShiftMutationKey) {
      return;
    }

    setPendingShiftMutationKey(`delete:${shiftId}`);
    setShiftMutationState({ status: "idle", message: "" });

    try {
      const response = await fetch("/api/admin/schedule/shifts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          periodId: selectedPeriod.id,
          shiftId,
        }),
      });

      const responsePayload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      const message = responsePayload?.message ?? "Day shift updated.";

      if (!response.ok) {
        setShiftMutationState({ status: "error", message });
        return;
      }

      setShiftMutationState({ status: "success", message });
      router.refresh();
    } catch (error) {
      setShiftMutationState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The day shift could not be removed right now. Please try again.",
      });
    } finally {
      setPendingShiftMutationKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">
              {formatSchedulePeriodHeading(selectedPeriod)}
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance text-slate-950 sm:text-5xl">
              Schedule Creator
            </h1>
            <p className="text-sm leading-7 text-slate-600 sm:text-base">
              Review readiness, queue future generation runs, edit draft assignments, and publish
              a validated schedule from one place.
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
                  {formatSchedulePeriodOptionLabel(period)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
                Schedule readiness
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {model.readiness.allReady ? "Ready to generate" : "Generation blocked"}
              </h2>
            </div>
            <span
              className={[
                "inline-flex w-fit rounded-full px-4 py-2 text-sm font-semibold",
                model.readiness.allReady
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700",
              ].join(" ")}
            >
              {model.readiness.allReady
                ? "All staff data and availability requirements are complete."
                : "Fix the blocking readiness items before generation."}
            </span>
          </div>

          <div className="mt-6 space-y-3">
            {model.readiness.checks.map((check) => (
              <div
                key={check.key}
                className={`rounded-[1.4rem] border px-4 py-4 ${readinessTone(check.status)}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{check.label}</p>
                    <p className="mt-1 text-sm">{check.summary}</p>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                    {check.status === "ready" ? "Ready" : "Attention"}
                  </span>
                </div>
                {check.details.length > 0 ? (
                  <div className="mt-3 text-sm">
                    {check.details.join(", ")}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <form action={generationAction}>
              <input type="hidden" name="periodId" value={selectedPeriod.id} />
              <button
                type="submit"
                disabled={!model.canGenerateDraft || isGenerating}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isGenerating ? "Queuing..." : "Generate Draft Schedule"}
              </button>
            </form>

            <form action={publishAction}>
              <input type="hidden" name="periodId" value={selectedPeriod.id} />
              <button
                type="submit"
                disabled={!model.canPublishDraft || isPublishing}
                className="inline-flex h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                {isPublishing ? "Publishing..." : "Publish Schedule"}
              </button>
            </form>
          </div>

          {generationState.status !== "idle" ? (
            <div
              className={[
                "mt-4 rounded-2xl px-4 py-3 text-sm font-medium",
                generationState.status === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-rose-200 bg-rose-50 text-rose-700",
              ].join(" ")}
            >
              {generationState.message}
            </div>
          ) : null}
          {publishState.status !== "idle" ? (
            <div
              className={[
                "mt-4 rounded-2xl px-4 py-3 text-sm font-medium",
                publishState.status === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-rose-200 bg-rose-50 text-rose-700",
              ].join(" ")}
            >
              {publishState.message}
            </div>
          ) : null}
          {moveState.status !== "idle" ? (
            <div
              className={[
                "mt-4 rounded-2xl px-4 py-3 text-sm font-medium",
                moveState.status === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-rose-200 bg-rose-50 text-rose-700",
              ].join(" ")}
            >
              {moveState.message}
            </div>
          ) : null}
          {shiftMutationState.status !== "idle" ? (
            <div
              className={[
                "mt-4 rounded-2xl px-4 py-3 text-sm font-medium",
                shiftMutationState.status === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-rose-200 bg-rose-50 text-rose-700",
              ].join(" ")}
            >
              {shiftMutationState.message}
            </div>
          ) : null}

          {managerReview ? (
            <details
              className="mt-6 rounded-[1.7rem] border border-amber-200 bg-amber-50/90 px-5 py-5 sm:px-6"
              open
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                      Manager Review Required
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                      {managerReview.headline ?? "Schedule needs review before publishing"}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      Review the blocker summary before editing the draft schedule below. This
                      review came from the generation run and is not treated as a technical crash.
                    </p>
                  </div>
                  <span className="inline-flex w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
                    {managerReview.status ?? "Blocked"}
                  </span>
                </div>
              </summary>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Ready for commit
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-950">
                    {formatNullableBoolean(managerReview.readyForCommit)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Requires human review
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-950">
                    {formatNullableBoolean(managerReview.requiresHumanReview)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Assignments
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {metricValue(managerReview.summary.assignmentCount)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Unfilled shifts
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {metricValue(managerReview.summary.unfilledShiftCount)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Hard rule violations
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {metricValue(managerReview.summary.hardRuleViolationCount)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Soft warnings
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {metricValue(managerReview.summary.softRuleWarningCount)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Human review flags
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {metricValue(managerReview.summary.humanReviewFlagCount)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Repair groups
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {metricValue(managerReview.summary.repairCandidateGroupCount)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Recommended candidates
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {metricValue(managerReview.summary.totalRecommendedCandidateCount)}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3 xl:col-span-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    No rule-clean candidates
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {metricValue(managerReview.summary.shiftsWithoutRuleCleanCandidates)}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Blocking issues
                    </p>
                    {managerReview.blockingIssues.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {managerReview.blockingIssues.map((issue, index) => (
                          <div
                            key={`${issue.shiftId ?? "no-shift"}-${issue.message}-${index}`}
                            className="rounded-2xl border border-rose-200 bg-white px-4 py-3"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-slate-950">
                                  {issue.message}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {issue.shiftDate ?? "Date TBD"} ·{" "}
                                  {formatManagerReviewShiftType(issue.shiftType)}
                                </p>
                              </div>
                              <span className="inline-flex w-fit rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                                Missing {metricValue(issue.missingCount)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-slate-600">
                        No blocking issue details were provided.
                      </p>
                    )}
                  </div>

                  {managerReview.nextActions.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Next actions
                      </p>
                      <ul className="mt-3 space-y-2 text-sm text-slate-700">
                        {managerReview.nextActions.map((action, index) => (
                          <li
                            key={`${action}-${index}`}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                          >
                            {action}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Repair options
                    </p>
                    {managerReview.repairOptions.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {managerReview.repairOptions.map((option, index) => (
                          <div
                            key={`${option.shiftId ?? "unknown"}-${index}`}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                          >
                            <div className="flex flex-col gap-3">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-slate-950">
                                    {option.shiftDate ?? "Date TBD"} ·{" "}
                                    {formatManagerReviewShiftType(option.shiftType)}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Rule-clean candidate available:{" "}
                                    {formatNullableBoolean(option.hasRuleCleanCandidate)}
                                  </p>
                                </div>
                                <span className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                  {metricValue(option.recommendedCandidateCount)} recommended
                                </span>
                              </div>
                              {option.topBlockedCandidates.length > 0 ? (
                                <div className="space-y-2">
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Top blocked candidates
                                  </p>
                                  {option.topBlockedCandidates.map((candidate, candidateIndex) => (
                                    <div
                                      key={`${formatBlockedCandidateLabel(candidate.staffName)}-${candidateIndex}`}
                                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                                    >
                                      <p className="text-sm font-semibold text-slate-950">
                                        {formatBlockedCandidateLabel(candidate.staffName)}
                                      </p>
                                      {candidate.blockerMessages.length > 0 ? (
                                        <ul className="mt-2 space-y-1 text-sm text-slate-600">
                                          {candidate.blockerMessages.map((message, messageIndex) => (
                                            <li key={`${message}-${messageIndex}`}>{message}</li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="mt-2 text-sm text-slate-500">
                                          No blocker detail was provided for this candidate.
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-slate-500">
                                  No blocked candidate detail was provided for this repair option.
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-slate-600">
                        No repair option details were provided.
                      </p>
                    )}
                  </div>

                  {managerReview.humanReviewFlags.length > 0 ? (
                    <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Human review flags
                      </summary>
                      <ul className="mt-3 space-y-2 text-sm text-slate-600">
                        {managerReview.humanReviewFlags.map((flag, index) => (
                          <li key={`${flag}-${index}`}>{flag}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {managerReview.softWarnings.length > 0 ? (
                    <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Soft warnings
                      </summary>
                      <ul className="mt-3 space-y-2 text-sm text-slate-600">
                        {managerReview.softWarnings.map((warning, index) => (
                          <li key={`${warning}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </div>
            </details>
          ) : null}
        </article>

        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
            Generation status
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            {model.latestRun ? model.latestRun.statusLabel : "Not started"}
          </h2>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            {model.latestRun ? (
              <>
                <p>
                  Stage: <span className="font-medium text-slate-950">{model.latestRun.currentStage}</span>
                </p>
                <p>
                  Started:{" "}
                  <span className="font-medium text-slate-950">
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(model.latestRun.startedAt))}
                  </span>
                </p>
                {managerReview ? (
                  <p className="text-amber-700">
                    Draft generation completed with review blockers. Please review the manager panel
                    below before publishing.
                  </p>
                ) : null}
                {model.latestRun.failureMessage ? (
                  <p className="text-rose-700">{model.latestRun.failureMessage}</p>
                ) : (
                  <p>
                    {managerReview
                      ? "Manager review findings are available for this run."
                      : "Draft generation is ready to be connected to future orchestration."}
                  </p>
                )}
              </>
            ) : (
              <p>Generation workflow is ready to be connected.</p>
            )}
          </div>

          <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50/90 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Current schedule view
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {formatScheduleStatusLabel(model.activeLifecycle)}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {model.hasDraftSchedule
                ? "Managers are currently looking at draft assignments."
                : model.hasPublishedSchedule
                  ? "Only the published schedule exists for this period right now."
                  : "No assignments have been created for this period yet."}
            </p>
          </div>
        </article>
      </section>

      <section>
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-5">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
                Draft schedule
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {new Intl.DateTimeFormat("en-US", {
                  month: "long",
                  year: "numeric",
                }).format(parseScheduleDateKey(selectedPeriod.start_date))}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                A month view gives you the whole period at once. Tap a colored shift block to edit
                its assignments or drag a staff pill onto another shift to rebalance coverage.
              </p>
            </div>
          </div>

          {!model.hasDraftSchedule ? (
            <div className="mt-6 rounded-[1.6rem] border border-dashed border-amber-300 bg-amber-50/70 px-4 py-6 text-sm text-amber-800">
              <p className="font-semibold text-slate-950">
                {model.needsDraftSave
                  ? "Draft assignments have not been saved yet. Run the draft save step before editing."
                  : "No draft assignments have been saved for this period yet."}
              </p>
              <p className="mt-2">
                {model.hasPublishedSchedule
                  ? "The published schedule still exists, but there is no persisted draft schedule to edit."
                  : "Once draft assignment rows are saved, the proposed schedule will appear here for manager review and editing."}
              </p>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto pb-2">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-7 gap-px rounded-[1.8rem] bg-slate-200 p-px shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                    <div
                      key={label}
                      className="bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500"
                    >
                      {label}
                    </div>
                  ))}

                  {calendarWeeks.flatMap((week) =>
                    week.map((day) => (
                      <div
                        key={day.dateKey}
                        className={[
                          "min-h-[15rem] px-3 py-3",
                          day.inPeriod ? "bg-white" : "bg-slate-50/90",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day.date)}
                            </p>
                            <p
                              className={[
                                "mt-1 text-lg font-semibold",
                                day.inPeriod ? "text-slate-950" : "text-slate-400",
                              ].join(" ")}
                            >
                              {day.date.getDate()}
                            </p>
                          </div>
                        </div>

                        {day.inPeriod ? (
                          <div className="mt-3 space-y-2">
                            {day.shifts.length > 0 ? (
                              day.shifts.map((shift) =>
                                isDraftEditable ? (
                                  <div
                                    key={shift.id}
                                    onClick={() => void loadDrawerData(shift)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        void loadDrawerData(shift);
                                      }
                                    }}
                                    onDragOver={(event) => {
                                      if (!draggedAssignment || draggedAssignment.fromShiftId === shift.id) {
                                        return;
                                      }
                                      event.preventDefault();
                                      setDropTargetShiftId(shift.id);
                                    }}
                                    onDragLeave={() => {
                                      setDropTargetShiftId((current) =>
                                        current === shift.id ? null : current,
                                      );
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault();
                                      void moveAssignment(shift);
                                    }}
                                    className={`block w-full rounded-2xl border px-3 py-3 text-left transition ${shiftTone(shift)} ${
                                      dropTargetShiftId === shift.id
                                        ? "ring-2 ring-slate-950/20 ring-offset-2"
                                        : ""
                                    }`}
                                    role="button"
                                    tabIndex={0}
                                  >
                                    <div
                                      className={`flex flex-wrap gap-2 ${
                                        shift.assignments.length === 0
                                          ? "justify-center text-center"
                                          : "items-start justify-between"
                                      }`}
                                    >
                                      <div className={shift.assignments.length === 0 ? "w-full" : ""}>
                                        <p className="text-sm font-semibold">
                                          {formatShiftTypeLabel(shift.shiftType)}
                                        </p>
                                        {getShiftTimeLabel(shift) ? (
                                          <p className="mt-1 text-[0.72rem] font-medium opacity-80">
                                            {getShiftTimeLabel(shift)}
                                          </p>
                                        ) : null}
                                      </div>
                                      {shift.shiftType === "day" ? (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            void removeDayShift(shift.id);
                                          }}
                                          disabled={pendingShiftMutationKey === `delete:${shift.id}`}
                                          className="mx-auto shrink-0 rounded-full border border-slate-300 bg-white/90 px-1.5 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.08em] text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {pendingShiftMutationKey === `delete:${shift.id}` ? "Removing..." : "Remove"}
                                        </button>
                                      ) : null}
                                    </div>
                                    <div
                                      className={`mt-3 flex flex-wrap gap-2 text-sm ${
                                        shift.assignments.length === 0 ? "justify-center" : ""
                                      }`}
                                    >
                                      {shift.assignments.length === 0 ? (
                                        <span className="rounded-full border border-rose-200 bg-white/90 px-3 py-2 text-center font-medium text-rose-700">
                                          Unassigned
                                        </span>
                                      ) : (
                                        shift.assignments.map((assignment) => (
                                          <span
                                            key={assignment.id}
                                            draggable={isDraftEditable && !isMovingAssignment}
                                            onDragStart={(event) => {
                                              event.stopPropagation();
                                              event.dataTransfer.effectAllowed = "move";
                                              setDraggedAssignment({
                                                assignmentId: assignment.id,
                                                fromShiftId: shift.id,
                                                staffId: assignment.staffId,
                                                staffName: assignment.staffName,
                                              });
                                            }}
                                            onDragEnd={() => {
                                              setDraggedAssignment(null);
                                              setDropTargetShiftId(null);
                                            }}
                                            onClick={(event) => event.stopPropagation()}
                                            className="inline-flex max-w-full cursor-grab rounded-full border px-3 py-1.5 font-medium shadow-sm active:cursor-grabbing"
                                            style={
                                              staffPillStyles.get(assignment.staffId) ??
                                              STAFF_PILL_PALETTE[0]
                                            }
                                          >
                                            <span className="truncate">{assignment.staffName}</span>
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    key={shift.id}
                                    className={`rounded-2xl border px-3 py-3 ${shiftTone(shift)}`}
                                  >
                                    <div
                                      className={`flex flex-wrap gap-2 ${
                                        shift.assignments.length === 0
                                          ? "justify-center text-center"
                                          : "items-start justify-between"
                                      }`}
                                    >
                                      <div className={shift.assignments.length === 0 ? "w-full" : ""}>
                                        <p className="text-sm font-semibold">
                                          {formatShiftTypeLabel(shift.shiftType)}
                                        </p>
                                        {getShiftTimeLabel(shift) ? (
                                          <p className="mt-1 text-[0.72rem] font-medium opacity-80">
                                            {getShiftTimeLabel(shift)}
                                          </p>
                                        ) : null}
                                      </div>
                                      {shift.shiftType === "day" ? (
                                        <button
                                          type="button"
                                          onClick={() => void removeDayShift(shift.id)}
                                          disabled={pendingShiftMutationKey === `delete:${shift.id}`}
                                          className="mx-auto shrink-0 rounded-full border border-slate-300 bg-white/90 px-1.5 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.08em] text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {pendingShiftMutationKey === `delete:${shift.id}` ? "Removing..." : "Remove"}
                                        </button>
                                      ) : null}
                                    </div>
                                    <div
                                      className={`mt-3 flex flex-wrap gap-2 text-sm ${
                                        shift.assignments.length === 0 ? "justify-center" : ""
                                      }`}
                                    >
                                      {shift.assignments.length === 0 ? (
                                        <span className="rounded-full border border-rose-200 bg-white/90 px-3 py-2 text-center font-medium text-rose-700">
                                          Unassigned
                                        </span>
                                      ) : (
                                        shift.assignments.map((assignment) => (
                                          <span
                                            key={assignment.id}
                                            className="inline-flex max-w-full rounded-full border px-3 py-1.5 font-medium shadow-sm"
                                            style={
                                              staffPillStyles.get(assignment.staffId) ??
                                              STAFF_PILL_PALETTE[0]
                                            }
                                          >
                                            <span className="truncate">{assignment.staffName}</span>
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                ),
                              )
                            ) : (
                              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                                No shifts scheduled.
                              </div>
                            )}
                            {isDraftEditable && !day.shifts.some((shift) => shift.shiftType === "day") ? (
                              <button
                                type="button"
                                onClick={() => void createDayShift(day.dateKey)}
                                disabled={pendingShiftMutationKey === `create:${day.dateKey}`}
                                className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {pendingShiftMutationKey === `create:${day.dateKey}` ? "Adding day shift..." : "Add day shift"}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white/70 px-3 py-4 text-sm text-slate-400">
                            Outside this schedule period.
                          </div>
                        )}
                      </div>
                    )),
                  )}
                </div>
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Coverage
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
            {metricValue(model.metrics.coveragePercentage, "%")}
          </p>
        </article>
        <article className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Contract minimums
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
            {model.metrics.contractMinimumsMet === null || model.metrics.contractMinimumsTotal === null
              ? "—"
              : `${model.metrics.contractMinimumsMet} / ${model.metrics.contractMinimumsTotal}`}
          </p>
        </article>
        <article className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Budget usage
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
            {model.metrics.budgetUsed === null || model.metrics.budgetLimit === null
              ? "—"
              : `${formatCurrency(model.metrics.budgetUsed)} / ${formatCurrency(model.metrics.budgetLimit)}`}
          </p>
        </article>
        <article className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Issues
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
            {model.metrics.issueCount}
          </p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ScheduleBudgetPanel
          budget={model.budget}
          periodId={selectedPeriod.id}
          canEdit={selectedPeriod.status !== "published" && selectedPeriod.status !== "locked"}
        />

        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
              Validation issues
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Deterministic validation
            </h2>

            <div className="mt-4 space-y-4">
              {model.needsDraftSave ? (
                <div className="rounded-[1.4rem] border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-800">
                  Validation is hidden here because the latest generation run already produced a
                  manager review, but the draft assignments have not been saved into the database
                  yet. Save the generated draft first, then deterministic database validation will
                  reflect the draft schedule instead of an empty assignment state.
                </div>
              ) : null}
              {!model.needsDraftSave &&
              groupedIssues.block.length === 0 &&
              groupedIssues.warning.length === 0 ? (
                <div className="rounded-[1.4rem] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                  No schedule issues are currently reported for this period.
                </div>
              ) : null}

              {!model.needsDraftSave && groupedIssues.block.length > 0 ? (
                <div className={`rounded-[1.4rem] border px-4 py-4 ${issueTone("block")}`}>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em]">Block</p>
                  <div className="mt-3 space-y-3">
                    {groupedIssues.block.map((issue, index) => (
                      <div key={`${issue.message}-${index}`} className="rounded-2xl border border-rose-200 bg-white px-4 py-3">
                        <p className="text-sm font-medium">{issue.message}</p>
                        {(issue.staffName || issue.dateKey || issue.shiftType) ? (
                          <p className="mt-1 text-xs text-rose-600">
                            {[issue.staffName, issue.dateKey, issue.shiftType].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {!model.needsDraftSave && groupedIssues.warning.length > 0 ? (
                <div className={`rounded-[1.4rem] border px-4 py-4 ${issueTone("warning")}`}>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em]">Warning</p>
                  <div className="mt-3 space-y-3">
                    {groupedIssues.warning.map((issue, index) => (
                      <div key={`${issue.message}-${index}`} className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
                        <p className="text-sm font-medium">{issue.message}</p>
                        {(issue.staffName || issue.dateKey || issue.shiftType) ? (
                          <p className="mt-1 text-xs text-amber-700">
                            {[issue.staffName, issue.dateKey, issue.shiftType].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </article>
      </section>

      <ScheduleEditDrawer
        key={selectedShift?.id ?? "closed"}
        open={selectedShift !== null}
        onClose={() => {
          setSelectedShift(null);
          setDrawerData(null);
          setDrawerError(null);
        }}
        periodId={selectedPeriod.id}
        shift={selectedShift}
        drawerData={drawerData}
        isLoading={drawerLoading}
        loadError={drawerError}
        onRefresh={async () => {
          router.refresh();
          if (selectedShift) {
            await loadDrawerData(selectedShift);
          }
        }}
      />
    </div>
  );
}
