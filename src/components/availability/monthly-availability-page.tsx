'use client'

import { FormEvent, KeyboardEvent, MouseEvent, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AvailabilitySubmissionRequest } from "@/app/monthlyavailability/submission-route";
import type { AvailabilitySubmissionStatus, SchedulePeriodRow } from "@/lib/supabase/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHIFTS = [
  { key: "morning", label: "Morning", shortLabel: "M" },
  { key: "day", label: "Day", shortLabel: "D" },
  { key: "evening", label: "Evening", shortLabel: "E" },
] as const;

type ShiftKey = (typeof SHIFTS)[number]["key"];
type ShiftStatus = "available" | "unavailable";
type ShiftStatuses = Record<ShiftKey, ShiftStatus>;
type MonthAvailability = Record<string, Partial<Record<ShiftKey, ShiftStatus>>>;

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type ChangeState = { message: string; tone: "available" | "unavailable" } | null;

const DEFAULT_SHIFT_STATUSES: ShiftStatuses = {
  morning: "available",
  day: "available",
  evening: "available",
};

const EMPTY_MONTH_AVAILABILITY: MonthAvailability = {};

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatReadableDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDaysInPeriod(startDate: string, endDate: string) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const days: Date[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(new Date(cursor));
  }

  return days;
}

function formatPeriodLabel(period: Pick<SchedulePeriodRow, "name" | "start_date" | "end_date">) {
  if (period.name.trim()) {
    return period.name;
  }

  const start = parseDateKey(period.start_date);
  const end = parseDateKey(period.end_date);

  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return formatMonthLabel(start);
  }

  return `${formatReadableDate(period.start_date)} - ${formatReadableDate(period.end_date)}`;
}

function levenshteinDistance(source: string, target: string) {
  if (source === target) return 0;
  if (source.length === 0) return target.length;
  if (target.length === 0) return source.length;

  const matrix = Array.from({ length: source.length + 1 }, () =>
    Array<number>(target.length + 1).fill(0),
  );

  for (let row = 0; row <= source.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= target.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= source.length; row += 1) {
    for (let column = 1; column <= target.length; column += 1) {
      const cost = source[row - 1] === target[column - 1] ? 0 : 1;

      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }

  return matrix[source.length][target.length];
}

function normaliseName(input: string, staffRoster: string[]) {
  const cleanedInput = input.trim();

  if (!cleanedInput) {
    return input;
  }

  const loweredInput = cleanedInput.toLowerCase();
  const exactMatch = staffRoster.find((staffName) => staffName.trim().toLowerCase() === loweredInput);

  if (exactMatch) {
    return exactMatch;
  }

  let closestMatch = cleanedInput;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const staffName of staffRoster) {
    const distance = levenshteinDistance(loweredInput, staffName.trim().toLowerCase());

    if (distance < closestDistance) {
      closestDistance = distance;
      closestMatch = staffName;
    }
  }

  return closestDistance <= 2 ? closestMatch : input;
}

function getShiftStatuses(monthAvailability: MonthAvailability, dateKey: string): ShiftStatuses {
  const partialStatuses = monthAvailability[dateKey] ?? {};

  return {
    morning: partialStatuses.morning ?? DEFAULT_SHIFT_STATUSES.morning,
    day: partialStatuses.day ?? DEFAULT_SHIFT_STATUSES.day,
    evening: partialStatuses.evening ?? DEFAULT_SHIFT_STATUSES.evening,
  };
}

function getUnavailableShiftKeys(statuses: ShiftStatuses) {
  return SHIFTS.filter(({ key }) => statuses[key] === "unavailable").map(({ key }) => key);
}

function countMarkedOffDays(monthAvailability: MonthAvailability) {
  return Object.keys(monthAvailability).reduce((count, dateKey) => {
    const statuses = getShiftStatuses(monthAvailability, dateKey);
    const hasAnyUnavailableShift = SHIFTS.some(({ key }) => statuses[key] === "unavailable");
    return count + (hasAnyUnavailableShift ? 1 : 0);
  }, 0);
}

function buildShiftAvailability(days: Date[], monthAvailability: MonthAvailability) {
  return days.map((day) => {
    const dateKey = formatDateKey(day);
    const statuses = getShiftStatuses(monthAvailability, dateKey);

    return {
      date: dateKey,
      morning: statuses.morning,
      day: statuses.day,
      evening: statuses.evening,
    };
  });
}

function buildUnavailableShiftSummary(days: Date[], monthAvailability: MonthAvailability) {
  return days
    .map((day) => {
      const dateKey = formatDateKey(day);
      const statuses = getShiftStatuses(monthAvailability, dateKey);
      const shifts = SHIFTS.filter(({ key }) => statuses[key] === "unavailable").map(
        ({ key, label }) => ({ key, label }),
      );

      if (shifts.length === 0) {
        return null;
      }

      return {
        date: dateKey,
        shifts: shifts.map(({ key }) => key),
        labels: shifts.map(({ label }) => label),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

type MonthlyAvailabilityPageProps = {
  signedInEmail: string;
  initialStaffName: string;
  initialCopyEmail: string;
  staffRoster: string[];
  periods: SchedulePeriodRow[];
  selectedPeriod: SchedulePeriodRow;
  initialAvailabilityByDate: MonthAvailability;
  initialSubmissionStatus: AvailabilitySubmissionStatus | null;
  initialWillingToWorkAboveTarget: boolean;
  initialMaxExtraShiftsForPeriod: number | null;
};

export function MonthlyAvailabilityPage({
  signedInEmail,
  initialStaffName,
  initialCopyEmail,
  staffRoster,
  periods,
  selectedPeriod,
  initialAvailabilityByDate,
  initialSubmissionStatus,
  initialWillingToWorkAboveTarget,
  initialMaxExtraShiftsForPeriod,
}: MonthlyAvailabilityPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startNavigation] = useTransition();
  const [staffName, setStaffName] = useState(initialStaffName);
  const [email, setEmail] = useState(initialCopyEmail);
  const [availabilityByPeriod, setAvailabilityByPeriod] = useState<Record<string, MonthAvailability>>(
    {
      [selectedPeriod.id]: initialAvailabilityByDate,
    },
  );
  const [savedSubmissionStatus, setSavedSubmissionStatus] =
    useState<AvailabilitySubmissionStatus | null>(initialSubmissionStatus);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [lastChange, setLastChange] = useState<ChangeState>(null);

  const periodAvailability = availabilityByPeriod[selectedPeriod.id] ?? EMPTY_MONTH_AVAILABILITY;

  const days = useMemo(
    () => getDaysInPeriod(selectedPeriod.start_date, selectedPeriod.end_date),
    [selectedPeriod.end_date, selectedPeriod.start_date],
  );
  const firstDayOffset = days[0]?.getDay() ?? 0;

  const shiftAvailability = useMemo(
    () => buildShiftAvailability(days, periodAvailability),
    [days, periodAvailability],
  );

  const unavailableShiftSummary = useMemo(
    () => buildUnavailableShiftSummary(days, periodAvailability),
    [days, periodAvailability],
  );

  const unavailableDates = unavailableShiftSummary
    .filter((entry) => entry.shifts.length === SHIFTS.length)
    .map((entry) => entry.date);

  const markedOffDayCount = countMarkedOffDays(periodAvailability);

  function handleNameBlur() {
    setStaffName((currentName) => normaliseName(currentName, staffRoster));
  }

  function updateMonthAvailability(
    dateKey: string,
    updater: (currentStatuses: ShiftStatuses) => ShiftStatuses,
  ) {
    setAvailabilityByPeriod((currentMap) => {
      const currentPeriodAvailability = currentMap[selectedPeriod.id] ?? {};
      const currentStatuses = getShiftStatuses(currentPeriodAvailability, dateKey);
      const nextStatuses = updater(currentStatuses);

      return {
        ...currentMap,
        [selectedPeriod.id]: {
          ...currentPeriodAvailability,
          [dateKey]: nextStatuses,
        },
      };
    });

    if (submitState.status !== "idle") {
      setSubmitState({ status: "idle" });
    }
  }

  function handleDayToggle(dateKey: string) {
    const currentStatuses = getShiftStatuses(periodAvailability, dateKey);
    const allUnavailable = SHIFTS.every(({ key }) => currentStatuses[key] === "unavailable");
    const nextStatus: ShiftStatus = allUnavailable ? "available" : "unavailable";

    updateMonthAvailability(dateKey, () => ({
      morning: nextStatus,
      day: nextStatus,
      evening: nextStatus,
    }));

    setLastChange({
      message: `${formatReadableDate(dateKey)} marked ${
        allUnavailable ? "fully available" : "fully unavailable"
      }.`,
      tone: allUnavailable ? "available" : "unavailable",
    });
  }

  function handleShiftToggle(dateKey: string, shiftKey: ShiftKey, shiftLabel: string) {
    const currentStatuses = getShiftStatuses(periodAvailability, dateKey);
    const nextStatus: ShiftStatus =
      currentStatuses[shiftKey] === "unavailable" ? "available" : "unavailable";

    updateMonthAvailability(dateKey, (statuses) => ({
      ...statuses,
      [shiftKey]: nextStatus,
    }));

    setLastChange({
      message: `${formatReadableDate(dateKey)} ${shiftLabel.toLowerCase()} marked ${nextStatus}.`,
      tone: nextStatus,
    });
  }

  function handleShiftClick(
    event: MouseEvent<HTMLButtonElement>,
    dateKey: string,
    shiftKey: ShiftKey,
    shiftLabel: string,
  ) {
    event.stopPropagation();
    handleShiftToggle(dateKey, shiftKey, shiftLabel);
  }

  function handleDayCardKeyDown(event: KeyboardEvent<HTMLDivElement>, dateKey: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleDayToggle(dateKey);
    }
  }

  function handlePeriodChange(periodId: string) {
    startNavigation(() => {
      router.push(`${pathname}?period=${periodId}`);
    });

    setLastChange(null);

    if (submitState.status !== "idle") {
      setSubmitState({ status: "idle" });
    }
  }

  async function submitAvailability(submissionStatus: AvailabilitySubmissionStatus) {
    const canonicalName = normaliseName(staffName, staffRoster);

    setStaffName(canonicalName);

    if (!canonicalName.trim()) {
      setSubmitState({
        status: "error",
        message: "Enter your name before submitting.",
      });
      return;
    }

    setSubmitState({ status: "submitting" });

    try {
      const payload: AvailabilitySubmissionRequest = {
        period_id: selectedPeriod.id,
        period_name: selectedPeriod.name,
        submission_status: submissionStatus,
        staff_name: canonicalName,
        email,
        month: selectedPeriod.start_date.slice(0, 7),
        willing_to_work_above_target: initialWillingToWorkAboveTarget,
        max_extra_shifts_for_period: initialMaxExtraShiftsForPeriod,
        unavailable_dates: unavailableDates,
        unavailable_shifts: unavailableShiftSummary,
        shift_availability: shiftAvailability,
      };

      const response = await fetch("/api/availability", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;

        throw new Error(errorPayload?.message ?? `Submission returned ${response.status}`);
      }

      setSavedSubmissionStatus(submissionStatus);
      setSubmitState({
        status: "success",
        message:
          submissionStatus === "draft"
            ? `Draft saved for ${formatPeriodLabel(selectedPeriod)}.`
            : `Availability for ${formatPeriodLabel(selectedPeriod)} has been submitted.`,
      });
    } catch (error) {
      setSubmitState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn't submit right now. Please try again.",
      });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitAvailability("submitted");
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="grid gap-0 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6 bg-slate-950 px-6 py-8 text-white sm:px-8 lg:px-10">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-200">
                Monthly Availability
              </p>
              <div className="space-y-4">
                <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                  Mark the shifts you can&apos;t work for this schedule period.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  Supabase stores the submitted schedule-period availability directly. Tap a whole
                  day to mark the full date off, or use the morning, day, and evening buttons to
                  fine-tune it shift by shift.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Editing</p>
                  <p className="mt-2 text-lg font-medium text-white">
                    {formatPeriodLabel(selectedPeriod)}
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Marked off</p>
                  <p className="mt-2 text-lg font-medium text-white">
                    {markedOffDayCount} day{markedOffDayCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Quick tip</p>
                  <p className="mt-2 text-sm leading-6 text-slate-200">
                    Full-day tap for speed, individual shift tap for detail.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-8 sm:px-8 lg:px-10">
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="rounded-[1.6rem] border border-sky-200 bg-sky-50/90 px-4 py-4 text-sm leading-6 text-sky-900">
                  <p className="font-medium text-sky-950">Signed in</p>
                  <p className="mt-1">
                    You&apos;re submitting as <span className="font-semibold">{signedInEmail}</span>.
                    The studio will identify you from your login.
                  </p>
                  <p className="mt-2 text-sky-800">
                    The name and email below are only used for the confirmation copy and do not
                    have to match your login exactly.
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="period-select"
                    className="text-sm font-medium tracking-tight text-slate-700"
                  >
                    Schedule period
                  </label>
                  <select
                    id="period-select"
                    value={selectedPeriod.id}
                    onChange={(event) => handlePeriodChange(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    disabled={isNavigating}
                  >
                    {periods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {formatPeriodLabel(period)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      htmlFor="staff-name"
                      className="text-sm font-medium tracking-tight text-slate-700"
                    >
                      Your name
                    </label>
                    <input
                      id="staff-name"
                      type="text"
                      value={staffName}
                      onChange={(event) => setStaffName(event.target.value)}
                      onBlur={handleNameBlur}
                      placeholder="Type your name"
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      autoComplete="name"
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="staff-email"
                      className="text-sm font-medium tracking-tight text-slate-700"
                    >
                      Email for the copy
                    </label>
                    <input
                      id="staff-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/90 px-4 py-4 text-sm leading-6 text-slate-600">
                  <p className="font-medium text-slate-900">How it works</p>
                  <p className="mt-1">
                    White cards are open. Red marks mean unavailable. Amber means you&apos;ve only
                    blocked part of the day.
                  </p>
                  {lastChange ? (
                    <p
                      className={[
                        "mt-3 font-medium",
                        lastChange.tone === "unavailable" ? "text-rose-700" : "text-emerald-700",
                      ].join(" ")}
                    >
                      {lastChange.message}
                    </p>
                  ) : (
                    <p className="mt-3 text-slate-500">
                      Choose the shifts that should stay out of the schedule.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    disabled={submitState.status === "submitting"}
                    onClick={() => void submitAvailability("draft")}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  >
                    {submitState.status === "submitting"
                      ? "Saving..."
                      : savedSubmissionStatus === "draft"
                        ? "Update draft"
                        : "Save draft"}
                  </button>
                  <button
                    type="submit"
                    disabled={submitState.status === "submitting"}
                    className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {submitState.status === "submitting"
                      ? "Submitting..."
                      : savedSubmissionStatus === "submitted"
                        ? "Resubmit availability"
                        : "Submit availability"}
                  </button>
                </div>

                {submitState.status === "success" || submitState.status === "error" ? (
                  <div
                    className={[
                      "rounded-2xl px-4 py-3 text-sm font-medium",
                      submitState.status === "success"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : submitState.status === "error"
                          ? "border border-rose-200 bg-rose-50 text-rose-700"
                          : "border border-slate-200 bg-slate-100 text-slate-700",
                    ].join(" ")}
                  >
                    {submitState.message}
                  </div>
                ) : null}
              </form>
            </div>
          </div>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-6 lg:p-8">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
                Availability Calendar
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {formatPeriodLabel(selectedPeriod)}
              </h2>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">
              {selectedPeriod.start_date} to {selectedPeriod.end_date}
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[880px]">
              <div className="grid grid-cols-7 gap-3 text-center text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-400 sm:text-xs">
                {WEEKDAYS.map((weekday) => (
                  <div key={weekday} className="py-2">
                    {weekday}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-3">
                {Array.from({ length: firstDayOffset }).map((_, index) => (
                  <div
                    key={`empty-${index}`}
                    className="min-h-[10.5rem] rounded-[1.75rem] border border-transparent"
                    aria-hidden="true"
                  />
                ))}

                {days.map((day) => {
                  const dateKey = formatDateKey(day);
                  const statuses = getShiftStatuses(periodAvailability, dateKey);
                  const unavailableShiftKeys = getUnavailableShiftKeys(statuses);
                  const allUnavailable = unavailableShiftKeys.length === SHIFTS.length;
                  const someUnavailable =
                    unavailableShiftKeys.length > 0 && unavailableShiftKeys.length < SHIFTS.length;

                  return (
                    <div
                      key={dateKey}
                      role="button"
                      tabIndex={0}
                      aria-pressed={allUnavailable}
                      onClick={() => handleDayToggle(dateKey)}
                      onKeyDown={(event) => handleDayCardKeyDown(event, dateKey)}
                      aria-label={`${day.getDate()} availability editor`}
                      className={[
                        "group min-h-[10.5rem] w-full touch-manipulation cursor-pointer select-none rounded-[1.75rem] border text-left transition active:scale-[0.98]",
                        allUnavailable
                          ? "border-rose-300 bg-rose-100 text-rose-900 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.1)]"
                          : someUnavailable
                            ? "border-amber-300 bg-amber-50 text-slate-900 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.08)]"
                            : "border-slate-200 bg-white text-slate-900 hover:border-sky-300 hover:bg-sky-50",
                      ].join(" ")}
                    >
                      <div className="flex h-full flex-col justify-between p-4">
                        <div className="flex items-start justify-between gap-3">
                          <span
                            className={[
                              "text-2xl font-semibold tracking-tight",
                              allUnavailable ? "line-through decoration-2 decoration-rose-500" : "",
                            ].join(" ")}
                          >
                            {day.getDate()}
                          </span>
                          <span
                            className={[
                              "rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em]",
                              allUnavailable
                                ? "bg-rose-200 text-rose-800"
                                : someUnavailable
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-emerald-100 text-emerald-700",
                            ].join(" ")}
                          >
                            {allUnavailable ? "All off" : someUnavailable ? "Mixed" : "Open"}
                          </span>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-2">
                          {SHIFTS.map(({ key, label, shortLabel }) => {
                            const isUnavailable = statuses[key] === "unavailable";

                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={(event) => handleShiftClick(event, dateKey, key, label)}
                                aria-pressed={isUnavailable}
                                aria-label={`${label} ${isUnavailable ? "unavailable" : "available"}`}
                                className={[
                                  "inline-flex h-11 items-center justify-center rounded-2xl border text-sm font-semibold uppercase tracking-[0.14em] transition active:scale-[0.98]",
                                  isUnavailable
                                    ? "border-rose-300 bg-rose-200 text-rose-800"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100",
                                ].join(" ")}
                              >
                                {shortLabel}
                              </button>
                            );
                          })}
                        </div>

                        <span className="mt-4 flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={[
                              "h-2.5 w-2.5 rounded-full",
                              allUnavailable
                                ? "bg-rose-500"
                                : someUnavailable
                                  ? "bg-amber-500"
                                  : "bg-emerald-500",
                            ].join(" ")}
                          />
                          <span className="sr-only">
                            {allUnavailable
                              ? "Fully unavailable"
                              : someUnavailable
                                ? "Partially unavailable"
                                : "Fully available"}
                          </span>
                          <span
                            aria-hidden="true"
                            className={[
                              "h-0.5 flex-1 rounded-full",
                              allUnavailable
                                ? "bg-rose-300"
                                : someUnavailable
                                  ? "bg-amber-300"
                                  : "bg-emerald-300",
                            ].join(" ")}
                          />
                          <span
                            aria-hidden="true"
                            className={[
                              "h-0.5 w-4 rounded-full",
                              allUnavailable
                                ? "bg-rose-300"
                                : someUnavailable
                                  ? "bg-amber-300"
                                  : "bg-emerald-300",
                            ].join(" ")}
                          />
                          <span
                            aria-hidden="true"
                            className={[
                              "h-0.5 w-3 rounded-full",
                              allUnavailable
                                ? "bg-rose-300"
                                : someUnavailable
                                  ? "bg-amber-300"
                                  : "bg-emerald-300",
                            ].join(" ")}
                          />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
      </section>
    </div>
  );
}
