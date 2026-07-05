"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  INITIAL_SCHEDULE_MUTATION_STATE,
  publishSchedulePeriodAction,
  queueScheduleGenerationAction,
} from "@/app/(authenticated)/admin/schedule/actions";
import { ScheduleEditDrawer } from "@/components/admin/schedule/schedule-edit-drawer";
import {
  formatScheduleLongDate,
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

function getInitialWeekIndex(weeks: ScheduleCreatorViewModel["weeks"], period: SchedulePeriodRow) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const index = weeks.findIndex((week) => week.startKey <= todayKey && week.endKey >= todayKey);

  if (todayKey >= period.start_date && todayKey <= period.end_date && index >= 0) {
    return index;
  }

  return 0;
}

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
  const [weekIndex, setWeekIndex] = useState(() =>
    getInitialWeekIndex(model.weeks, selectedPeriod),
  );
  const [drawerData, setDrawerData] = useState<ScheduleDrawerData | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const visibleWeek = model.weeks[weekIndex] ?? null;
  const groupedIssues = useMemo(
    () => ({
      block: model.validationIssues.filter((issue) => issue.severity === "block"),
      warning: model.validationIssues.filter((issue) => issue.severity === "warning"),
    }),
    [model.validationIssues],
  );
  const isDraftEditable =
    selectedPeriod.status !== "published" && selectedPeriod.status !== "locked";

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

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
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
                {model.latestRun.failureMessage ? (
                  <p className="text-rose-700">{model.latestRun.failureMessage}</p>
                ) : (
                  <p>Draft generation is ready to be connected to future orchestration.</p>
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
              : `${model.metrics.budgetUsed} / ${model.metrics.budgetLimit}`}
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

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
                Draft schedule
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {visibleWeek ? visibleWeek.label : "No week selected"}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWeekIndex((current) => Math.max(0, current - 1))}
                disabled={weekIndex === 0}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous week
              </button>
              <button
                type="button"
                onClick={() =>
                  setWeekIndex((current) => Math.min(model.weeks.length - 1, current + 1))
                }
                disabled={weekIndex >= model.weeks.length - 1}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next week
              </button>
            </div>
          </div>

          {visibleWeek ? (
            <div className="mt-6 space-y-4">
              {visibleWeek.shiftsByDate.map((day) => (
                <div
                  key={day.dateKey}
                  className="rounded-[1.6rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
                          new Date(`${day.dateKey}T12:00:00`),
                        )}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-950">
                        {formatScheduleLongDate(day.dateKey)}
                      </h3>
                    </div>
                    <span className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                      {formatScheduleStatusLabel(model.activeLifecycle)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-3">
                    {day.shifts.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
                        No shifts are configured for this date yet.
                      </div>
                    ) : (
                      day.shifts.map((shift) => (
                        <article
                          key={shift.id}
                          className="rounded-2xl border border-white/90 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">
                                {shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1)}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatShiftTimeRange(shift)}
                              </p>
                            </div>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-600">
                              {shift.assignments.length} / {shift.requiredCount}
                            </span>
                          </div>

                          <div className="mt-4 space-y-2">
                            {shift.assignments.length === 0 ? (
                              <p className="text-sm text-slate-500">—</p>
                            ) : (
                              shift.assignments.map((assignment) => (
                                <div
                                  key={assignment.id}
                                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                                >
                                  <p className="text-sm font-medium text-slate-950">
                                    {assignment.staffName}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {formatScheduleStatusLabel(assignment.lifecycle)}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>

                          {isDraftEditable ? (
                            <button
                              type="button"
                              onClick={() => void loadDrawerData(shift)}
                              className="mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                            >
                              Edit assignments
                            </button>
                          ) : null}
                        </article>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-[1.6rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No week is available for this schedule period yet.
            </div>
          )}
        </article>

        <div className="space-y-4">
          <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
              Budget readiness
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Staffing budgets
            </h2>
            <div className="mt-4 space-y-3">
              {model.budgets.length === 0 ? (
                <div className="rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  Staffing budget not configured.
                </div>
              ) : (
                model.budgets.map((budget) => (
                  <div
                    key={budget.id}
                    className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{budget.label}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                          {budget.scope === "role" ? "Role budget" : "Staff budget"}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-slate-950">
                        {budget.maxShifts} shifts
                      </span>
                    </div>
                    {budget.notes ? (
                      <p className="mt-3 text-sm text-slate-600">{budget.notes}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
              Validation issues
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Deterministic validation
            </h2>

            <div className="mt-4 space-y-4">
              {groupedIssues.block.length === 0 && groupedIssues.warning.length === 0 ? (
                <div className="rounded-[1.4rem] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                  No schedule issues are currently reported for this period.
                </div>
              ) : null}

              {groupedIssues.block.length > 0 ? (
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

              {groupedIssues.warning.length > 0 ? (
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
        </div>
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
