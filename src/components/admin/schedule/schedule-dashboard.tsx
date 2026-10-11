"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  revalidateAvailabilityAction,
  publishSchedulePeriodAction,
  queueScheduleGenerationAction,
} from "@/app/(authenticated)/admin/schedule/actions";
import { INITIAL_SCHEDULE_MUTATION_STATE } from "@/app/(authenticated)/admin/schedule/action-state";
import { ScheduleComparison } from "@/components/admin/schedule/schedule-comparison";
import { ScheduleAttentionPanel } from "@/components/admin/schedule/schedule-attention-panel";
import { ScheduleBudgetPanel } from "@/components/admin/schedule/schedule-budget-panel";
import { ScheduleEditDrawer } from "@/components/admin/schedule/schedule-edit-drawer";
import { formatSubmittedAt } from "@/lib/admin/availability";
import {
  formatSchedulePeriodHeading,
  formatSchedulePeriodOptionLabel,
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
  if (shift.shiftType !== "day" && shift.assignments.length === 0) {
    return "border-rose-200 bg-rose-50 text-rose-950 hover:border-rose-300 hover:bg-rose-50";
  }

  if (shift.shiftType !== "day" && shift.assignments.length < shift.requiredCount) {
    return "border-slate-300 bg-slate-100 text-slate-900 hover:border-slate-400 hover:bg-slate-100";
  }

  return "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-slate-100";
}

function formatShiftTypeLabel(value: ScheduleShiftView["shiftType"]) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const STAFF_PILL_PALETTE = [
  { backgroundColor: "#fef3c7", borderColor: "#fde68a", color: "#78350f" },
  { backgroundColor: "#dbeafe", borderColor: "#bfdbfe", color: "#1e3a8a" },
  { backgroundColor: "#e9d5ff", borderColor: "#ddd6fe", color: "#581c87" },
  { backgroundColor: "#dcfce7", borderColor: "#bbf7d0", color: "#14532d" },
  { backgroundColor: "#fee2e2", borderColor: "#fecaca", color: "#7f1d1d" },
  { backgroundColor: "#fde68a", borderColor: "#fed7aa", color: "#7c2d12" },
  { backgroundColor: "#cffafe", borderColor: "#a5f3fc", color: "#164e63" },
  { backgroundColor: "#fbcfe8", borderColor: "#fbcfe8", color: "#831843" },
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
  const [validationState, validationAction, isValidating] = useActionState(revalidateAvailabilityAction, INITIAL_SCHEDULE_MUTATION_STATE);
  const availabilityChanged = (selectedPeriod.availability_revision ?? 0) !== (selectedPeriod.validated_availability_revision ?? 0);
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

  const activeRun = model.latestRun && ["queued","planning","validating","analyzing_availability","fairness_review"].includes(model.latestRun.status);
  useEffect(() => {
    if (!activeRun) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [activeRun, router]);

  const [activeTab, setActiveTab] = useState<"budget" | "actions" | "calendar">("budget");
  const [calendarVersion, setCalendarVersion] = useState<"current" | "flexible">("current");
  const [expandedEmptyDayDates, setExpandedEmptyDayDates] = useState<string[]>([]);
  const [requestedPreviewId, setRequestedPreviewId] = useState<string | null>(null);
  const previewViewing = calendarVersion === "flexible";
  const displayedWeeks = useMemo(() => previewViewing ? model.flexiblePreview?.weeks ?? [] : model.weeks, [previewViewing, model.flexiblePreview, model.weeks]);
  const previewBusy = model.previewGeneration && ["queued", "planning", "validating", "analyzing_availability", "fairness_review"].includes(model.previewGeneration.status);
  const standardGaps = model.weeks.flatMap(week => week.shiftsByDate).flatMap(day => day.shifts)
    .filter(shift => shift.shiftType !== "day").reduce((total, shift) => total + Math.max(0, shift.requiredCount - shift.assignments.length), 0);
  const blockingCount = model.validationIssues.filter(issue => issue.severity === "block").length;
  function selectTab(tab: "budget" | "actions" | "calendar") {
    setActiveTab(tab);
    window.history.replaceState(null, "", `#schedule-${tab}`);
  }
  useEffect(() => {
    const syncHash = () => {
      const value = window.location.hash;
      setActiveTab(value === "#schedule-calendar" ? "calendar" : value === "#schedule-actions" ? "actions" : "budget");
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [selectedPeriod.id]);
  useEffect(() => {
    if (!previewBusy) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [previewBusy, router]);
  const calendarWeeks = useMemo(() => {
    const daysByKey = new Map(
      displayedWeeks.flatMap((week) => week.shiftsByDate).map((day) => [day.dateKey, day]),
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
          shifts: (day?.shifts ?? []).filter(shift => shift.shiftType !== "day" || shift.assignments.length > 0 || (!previewViewing && expandedEmptyDayDates.includes(dateKey))),
        });
      }

      weeks.push(week);
      cursor = addCalendarDays(cursor, 7);
    }

    return weeks;
  }, [displayedWeeks, expandedEmptyDayDates, previewViewing, selectedPeriod.end_date, selectedPeriod.start_date]);
  const isDraftEditable =
    !previewViewing && selectedPeriod.status !== "published" && selectedPeriod.status !== "locked";
  const staffPillStyles = useMemo(() => {
    const uniqueStaffIds = Array.from(
      new Set(
        [...model.weeks, ...(model.flexiblePreview?.weeks ?? [])].flatMap((week) =>
          week.shiftsByDate.flatMap((day) =>
            day.shifts.flatMap((shift) => shift.assignments.map((assignment) => assignment.staffId)),
          ),
        ),
      ),
    ).sort((left, right) => left.localeCompare(right));

    return new Map(
      uniqueStaffIds.map((staffId, index) => [staffId, STAFF_PILL_PALETTE[index % STAFF_PILL_PALETTE.length]]),
    );
  }, [model.weeks, model.flexiblePreview]);

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

      setExpandedEmptyDayDates(dates => [...new Set([...dates, dateKey])]);
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
        if (response.status === 404) router.refresh();
        setShiftMutationState({ status: "error", message });
        return;
      }

      const dateKey = model.weeks.flatMap(week => week.shiftsByDate).find(day => day.shifts.some(shift => shift.id === shiftId))?.dateKey;
      setExpandedEmptyDayDates(dates => dates.filter(date => date !== dateKey));
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
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">
              {formatSchedulePeriodHeading(selectedPeriod)}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-950 sm:text-3xl">
              Schedule Creator
            </h1>
          </div>

          <div className="w-full max-w-sm">
            <label
              htmlFor="period-select"
              className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500"
            >
              Schedule period
            </label>
            <select
              id="period-select"
              value={selectedPeriod.id}
              onChange={(event) => handlePeriodChange(event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
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

      <div role="tablist" aria-label="Schedule sections" className="flex flex-wrap gap-2 text-sm">
        {([{key:"budget",label:"Budget & checks"},{key:"actions",label:"Generate & publish"},{key:"calendar",label:"Calendar"}] as const).map((tab, index) => <button key={tab.key} type="button" role="tab" id={`tab-${tab.key}`} aria-controls={`schedule-${tab.key}`} aria-selected={activeTab === tab.key} tabIndex={activeTab === tab.key ? 0 : -1} onClick={() => selectTab(tab.key)} onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
          if (next === null) return; event.preventDefault();
          selectTab((["budget", "actions", "calendar"] as const)[next]);
          (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
        }} className={`rounded-lg border px-4 py-2.5 font-medium ${activeTab === tab.key ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}>{tab.label}{tab.key === "budget" && model.attention.items.length > 0 ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{model.attention.items.length}</span> : null}</button>)}
      </div>
      <section id="schedule-calendar" role="tabpanel" aria-labelledby="tab-calendar" hidden={activeTab !== "calendar"} className="scroll-mt-4">
        {shiftMutationState.status !== "idle" && <p role="status" className={`mb-3 text-sm ${shiftMutationState.status === "error" ? "text-rose-700" : "text-slate-600"}`}>{shiftMutationState.message}</p>}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2" aria-label="Calendar version">
            <button type="button" aria-pressed={!previewViewing} onClick={() => setCalendarVersion("current")} className={`rounded-lg border px-3 py-2 text-sm font-medium ${!previewViewing ? "bg-slate-950 text-white" : "bg-white text-slate-700"}`}>{model.scheduleMode === "flexible" ? "Flexible schedule" : "Standard schedule"}</button>
            <button type="button" aria-pressed={previewViewing} disabled={!model.flexiblePreview && !previewBusy} onClick={() => setCalendarVersion("flexible")} className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-40 ${previewViewing ? "bg-slate-950 text-white" : "bg-white text-slate-700"}`}>Flexible preview</button>
          </div>
          {previewViewing && model.flexiblePreview && <form action={generationAction}><input type="hidden" name="periodId" value={selectedPeriod.id}/><input type="hidden" name="mode" value="adopt_flexible"/><input type="hidden" name="previewRunId" value={model.flexiblePreview.id}/><button disabled={!model.canGenerateDraft || isGenerating || previewBusy === true || model.adoptedPreviewId === model.flexiblePreview.id} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isGenerating ? "Selecting…" : model.adoptedPreviewId === model.flexiblePreview.id ? "Version selected" : "Use this version"}</button></form>}
        </div>
        {previewViewing && <p className="mb-3 text-sm text-slate-600">{previewBusy ? "Generating flexible preview…" : model.previewGeneration?.status === "failed" && requestedPreviewId === model.previewGeneration.id ? model.previewGeneration.failureMessage ?? "Preview failed. Try again from Generate & publish." : "Read-only preview. Use this version to replace the draft, then review before publishing."}</p>}
        {generationState.status !== "idle" && previewViewing && <p role="status" className="mb-3 text-sm">{generationState.message}</p>}
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
                {previewViewing ? "Flexible preview" : model.hasDraftSchedule ? "Draft schedule" : "Published schedule"}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {new Intl.DateTimeFormat("en-US", {
                  month: "long",
                  year: "numeric",
                }).format(parseScheduleDateKey(selectedPeriod.start_date))}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {previewViewing ? "Compare coverage and assignments with the standard schedule." : isDraftEditable ? "Select a shift to edit assignments, or drag a staff member to another shift." : "Published assignments for this schedule period."}
              </p>
            </div>
          </div>

          {!model.hasDraftSchedule && !model.hasPublishedSchedule ? (
            <div className="mt-6 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-4 py-6 text-sm text-amber-800">
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
            <div className="@container mt-5 pb-2">
              <div className="min-w-0">
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl @[900px]:grid-cols-7 bg-slate-200 p-px shadow-sm">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                    <div
                      key={label}
                      className="hidden bg-slate-50 px-2 py-2 text-xs @[900px]:block font-semibold uppercase tracking-[0.1em] text-slate-500"
                    >
                      {label}
                    </div>
                  ))}

                  {calendarWeeks.flatMap((week) =>
                    week.map((day) => (
                      <div
                        key={day.dateKey}
                        className={[
                          "min-w-0 px-2 py-2 @[900px]:min-h-32",
                          day.inPeriod ? "bg-white" : "hidden bg-slate-50/90 @[900px]:block",
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
                          <div className="mt-2 space-y-1.5">
                            {day.shifts.length > 0 ? (
                              day.shifts.map((shift) =>
                                isDraftEditable ? (
                                  <div
                                    key={shift.id}
                                    onClick={() => { if (!previewViewing) void loadDrawerData(shift); }}
                                    onKeyDown={(event) => {
                                      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
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
                                    className={`relative block w-full rounded-lg border p-2 text-left transition ${shiftTone(shift)} ${
                                      dropTargetShiftId === shift.id
                                        ? "ring-2 ring-slate-950/20 ring-offset-2"
                                        : ""
                                    }`}
                                    role="button"
                                    aria-label={`Edit ${formatShiftTypeLabel(shift.shiftType)} shift on ${day.dateKey}`}
                                    tabIndex={0}
                                  >
                                    <div
                                      className="flex items-start justify-between gap-1"
                                    >
                                      <div className={shift.shiftType === "day" && isDraftEditable ? "min-w-0 pr-6" : "min-w-0"}>
                                        <p className="text-xs font-semibold">
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
                                          aria-label={`Remove day shift on ${day.dateKey}`}
                                          title="Remove day shift"
                                          aria-busy={pendingShiftMutationKey === `delete:${shift.id}`}
                                          className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                            <path d="m4 4 8 8M12 4l-8 8" />
                                          </svg>
                                        </button>
                                      ) : null}
                                    </div>
                                    <div
                                      className="mt-1.5 flex flex-wrap gap-1 text-[0.6875rem]"
                                    >
                                      {shift.assignments.length === 0 ? (
                                        <span className={`font-medium ${shift.shiftType === "day" ? "text-slate-500" : "text-rose-700"}`}>
                                          {shift.shiftType === "day" ? "Optional" : "Unassigned"}
                                        </span>
                                      ) : (
                                        shift.assignments.map((assignment) => (
                                          <span
                                            key={assignment.id}
                                            title={assignment.staffName}
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
                                            onClick={(event) => { event.stopPropagation(); void loadDrawerData(shift); }}
                                            className="inline-flex max-w-full cursor-grab rounded-md border px-1.5 py-0.5 font-medium active:cursor-grabbing"
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
                                    className={`rounded-lg border p-2 ${shiftTone(shift)}`}
                                  >
                                    <div
                                      className="flex items-start justify-between gap-1"
                                    >
                                      <div className={shift.shiftType === "day" && isDraftEditable ? "min-w-0 pr-6" : "min-w-0"}>
                                        <p className="text-xs font-semibold">
                                          {formatShiftTypeLabel(shift.shiftType)}
                                        </p>
                                        {getShiftTimeLabel(shift) ? (
                                          <p className="mt-1 text-[0.72rem] font-medium opacity-80">
                                            {getShiftTimeLabel(shift)}
                                          </p>
                                        ) : null}
                                      </div>

                                    </div>
                                    <div
                                      className="mt-1.5 flex flex-wrap gap-1 text-[0.6875rem]"
                                    >
                                      {shift.assignments.length === 0 ? (
                                        <span className={`font-medium ${shift.shiftType === "day" ? "text-slate-500" : "text-rose-700"}`}>
                                          {shift.shiftType === "day" ? "Optional" : "Unassigned"}
                                        </span>
                                      ) : (
                                        shift.assignments.map((assignment) => (
                                          <span
                                            key={assignment.id}
                                            className="inline-flex max-w-full rounded-md border px-1.5 py-0.5 font-medium"
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
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                                No shifts scheduled.
                              </div>
                            )}
                            {isDraftEditable && !day.shifts.some((shift) => shift.shiftType === "day") ? (
                              <button
                                type="button"
                                onClick={() => void createDayShift(day.dateKey)}
                                disabled={pendingShiftMutationKey === `create:${day.dateKey}`}
                                className="w-full rounded-lg border border-dashed border-slate-300 bg-white px-2 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {pendingShiftMutationKey === `create:${day.dateKey}` ? "Adding day shift..." : "Add day shift"}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="sr-only">Outside this schedule period.</span>
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

      <section id="schedule-actions" role="tabpanel" aria-labelledby="tab-actions" hidden={activeTab !== "actions"} className="space-y-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold">Generate standard schedule</h2>
          <p className="mt-2 text-sm text-slate-600">{model.readiness.allReady ? "Staff setup and availability are ready." : "Resolve the readiness items before generating."}</p>
          {!model.readiness.allReady && <button type="button" className="mt-2 text-sm font-medium underline" onClick={() => selectTab("budget")}>Review readiness</button>}
          <form action={generationAction} className="mt-4"><input type="hidden" name="periodId" value={selectedPeriod.id}/><button disabled={!model.canGenerateDraft || isGenerating || previewBusy === true} className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{isGenerating ? "Starting…" : activeRun ? "Generation in progress" : "Generate standard schedule"}</button></form>
          {generationState.status !== "idle" && <p role="status" className="mt-3 text-sm">{generationState.message}</p>}
          {activeRun && <p role="status" className="mt-3 text-sm text-sky-800">Your schedule is being generated. You can leave and return.</p>}
          {model.latestRun?.failureMessage && <p className="mt-3 text-sm text-rose-700">{model.latestRun.failureMessage}</p>}
          {model.latestRun && <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer">Run details</summary><p className="mt-2">{model.latestRun.statusLabel} · Started {formatSubmittedAt(model.latestRun.startedAt)}</p></details>}
          {model.hasDraftSchedule && <button type="button" className="mt-3 text-sm font-medium underline" onClick={() => {setCalendarVersion("current"); selectTab("calendar");}}>View calendar</button>}
        </article>
        {model.hasDraftSchedule && <ScheduleComparison standardGaps={standardGaps} periodId={selectedPeriod.id} preview={model.flexiblePreview} disabled={!model.canGenerateDraft || isGenerating || previewBusy === true}
          onViewPreview={() => {setCalendarVersion("flexible"); selectTab("calendar");}}
          onPreviewQueued={id => {setRequestedPreviewId(id); setCalendarVersion("flexible"); selectTab("calendar"); router.refresh();}}/>}
        <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold">Publish schedule</h2>
          <p className="mt-2 text-sm text-slate-600">{model.hasPublishedSchedule && !model.hasDraftSchedule ? "Schedule published." : !model.hasDraftSchedule ? "Generate a draft first." : model.canPublishDraft && !availabilityChanged ? "Ready to publish." : blockingCount ? `Resolve ${blockingCount} blocking ${blockingCount === 1 ? "issue" : "issues"}.` : "Recheck the draft before publishing."}</p>
          {model.hasDraftSchedule && (!model.canPublishDraft || availabilityChanged) && <button type="button" className="mt-2 text-sm font-medium underline" onClick={() => selectTab("budget")}>Review checks</button>}
          <form action={publishAction} className="mt-4"><input type="hidden" name="periodId" value={selectedPeriod.id}/><button disabled={!model.canPublishDraft || isPublishing || availabilityChanged} className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{isPublishing ? "Publishing…" : "Publish schedule"}</button></form>
          {publishState.status !== "idle" && <p role="status" className="mt-3 text-sm">{publishState.message}</p>}
        </article>
      </section>
      <section id="schedule-budget" role="tabpanel" aria-labelledby="tab-budget" hidden={activeTab !== "budget"} className="space-y-4">
      {availabilityChanged && selectedPeriod.status === "drafting" && <form action={validationAction} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><input type="hidden" name="periodId" value={selectedPeriod.id}/><p className="font-semibold">Availability has changed</p><p className="mt-1">Review the affected shifts below and check the draft before publishing.</p><button disabled={isValidating} className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2">{isValidating ? "Checking…" : "Revalidate draft"}</button>{validationState.message && <p role="status" className="mt-2">{validationState.message}</p>}</form>}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <ScheduleBudgetPanel budget={model.budget} periodId={selectedPeriod.id} canEdit={selectedPeriod.status !== "published" && selectedPeriod.status !== "locked"}/>
          <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-lg font-semibold">Availability & setup</h2>
            <p className="mt-2 text-sm text-slate-600">{model.readiness.allReady ? "Ready to generate." : "Resolve these items before generating."}</p>
            <div className="mt-3 space-y-3">{model.readiness.checks.filter(check => check.status !== "ready" || check.key === "availability").map(check => <div key={check.key} className={`rounded-lg border p-3 text-sm ${readinessTone(check.status)}`}><p className="font-semibold">{check.label}</p><p className="mt-1">{check.summary}</p>{check.details.length > 0 && <p className="mt-2">{check.details.join(", ")}</p>}</div>)}</div>
            <button type="button" className="mt-4 text-sm font-medium underline" onClick={() => selectTab("actions")}>Continue to generation</button>
          </article>
        </div>
        {model.hasDraftSchedule && (model.attention.items.length > 0 || model.attention.warnings.length > 0 || !model.canPublishDraft || availabilityChanged) && <ScheduleAttentionPanel items={model.attention.items} warnings={model.attention.warnings} periodId={selectedPeriod.id}
          onNavigate={destination => selectTab(destination === "budget" ? "budget" : "calendar")}
          onReview={id => { const shift = model.weeks.flatMap(week => week.shiftsByDate).flatMap(day => day.shifts).find(item => item.id === id); if (shift) {setCalendarVersion("current"); selectTab("calendar"); void loadDrawerData(shift);} }}
          recheck={validationAction} pending={isValidating} checkMessage={validationState.message} publishBlocked={!model.canPublishDraft || availabilityChanged}/>
        }
        {model.hasDraftSchedule && model.canPublishDraft && !availabilityChanged && model.attention.items.length === 0 && <p className="text-sm text-emerald-800">Ready to publish. No blocking issues.</p>}
      </section>
      {moveState.status !== "idle" && activeTab === "calendar" && <p role="status" className="text-sm">{moveState.message}</p>}
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
