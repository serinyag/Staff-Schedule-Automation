'use client'

import { FormEvent, KeyboardEvent, MouseEvent, useMemo, useState } from "react";

const STAFF = ["Amelia Stone", "Jordan Patel", "Maya Chen"];
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

function getNextMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function formatMonthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

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

function getDaysInMonth(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const days = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: days }, (_, index) => new Date(year, month, index + 1));
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

function normaliseName(input: string) {
  const cleanedInput = input.trim();

  if (!cleanedInput) {
    return input;
  }

  const loweredInput = cleanedInput.toLowerCase();
  const exactMatch = STAFF.find((staffName) => staffName.trim().toLowerCase() === loweredInput);

  if (exactMatch) {
    return exactMatch;
  }

  let closestMatch = cleanedInput;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const staffName of STAFF) {
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

function countUnavailableShifts(monthAvailability: MonthAvailability) {
  return Object.keys(monthAvailability).reduce((count, dateKey) => {
    const statuses = getShiftStatuses(monthAvailability, dateKey);
    return count + getUnavailableShiftKeys(statuses).length;
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

export default function Home() {
  const [staffName, setStaffName] = useState("");
  const [email, setEmail] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(getNextMonthStart);
  const [availabilityByMonth, setAvailabilityByMonth] = useState<Record<string, MonthAvailability>>(
    {},
  );
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [lastChange, setLastChange] = useState<ChangeState>(null);

  const monthKey = formatMonthKey(visibleMonth);
  const monthAvailability = availabilityByMonth[monthKey] ?? EMPTY_MONTH_AVAILABILITY;

  const days = useMemo(() => getDaysInMonth(visibleMonth), [visibleMonth]);
  const firstDayOffset = days[0]?.getDay() ?? 0;

  const shiftAvailability = useMemo(
    () => buildShiftAvailability(days, monthAvailability),
    [days, monthAvailability],
  );

  const unavailableShiftSummary = useMemo(
    () => buildUnavailableShiftSummary(days, monthAvailability),
    [days, monthAvailability],
  );

  const unavailableDates = unavailableShiftSummary
    .filter((entry) => entry.shifts.length === SHIFTS.length)
    .map((entry) => entry.date);

  const unavailableShiftCount = countUnavailableShifts(monthAvailability);

  function handleNameBlur() {
    setStaffName((currentName) => normaliseName(currentName));
  }

  function updateMonthAvailability(
    dateKey: string,
    updater: (currentStatuses: ShiftStatuses) => ShiftStatuses,
  ) {
    setAvailabilityByMonth((currentMap) => {
      const currentMonthAvailability = currentMap[monthKey] ?? {};
      const currentStatuses = getShiftStatuses(currentMonthAvailability, dateKey);
      const nextStatuses = updater(currentStatuses);

      return {
        ...currentMap,
        [monthKey]: {
          ...currentMonthAvailability,
          [dateKey]: nextStatuses,
        },
      };
    });

    if (submitState.status !== "idle") {
      setSubmitState({ status: "idle" });
    }
  }

  function handleDayToggle(dateKey: string) {
    const currentStatuses = getShiftStatuses(monthAvailability, dateKey);
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
    const currentStatuses = getShiftStatuses(monthAvailability, dateKey);
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

  function handleMonthChange(direction: -1 | 1) {
    setVisibleMonth(
      (currentMonth) =>
        new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1),
    );
    setLastChange(null);

    if (submitState.status !== "idle") {
      setSubmitState({ status: "idle" });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const canonicalName = normaliseName(staffName);
    const webhookUrl = process.env.NEXT_PUBLIC_WEBHOOK_URL;

    setStaffName(canonicalName);

    if (!canonicalName.trim()) {
      setSubmitState({
        status: "error",
        message: "Enter your name before submitting.",
      });
      return;
    }

    if (!webhookUrl) {
      setSubmitState({
        status: "error",
        message: "Webhook URL is not configured yet.",
      });
      return;
    }

    setSubmitState({ status: "submitting" });

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          staff_name: canonicalName,
          email,
          submitted_at: new Date().toISOString(),
          month: monthKey,
          unavailable_dates: unavailableDates,
          unavailable_shifts: unavailableShiftSummary,
          shift_availability: shiftAvailability,
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }

      setSubmitState({
        status: "success",
        message: `Availability for ${formatMonthLabel(visibleMonth)} has been submitted.`,
      });
    } catch {
      setSubmitState({
        status: "error",
        message: "We couldn't submit right now. Please try again.",
      });
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(188,212,255,0.45),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="grid gap-0 xl:grid-cols-[0.92fr_1.08fr]">
            <div className="flex flex-col justify-between gap-8 border-b border-slate-200/80 bg-slate-950 px-6 py-8 text-white sm:px-8 xl:border-r xl:border-b-0">
              <div className="space-y-5">
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-200">
                  Staff Availability
                </p>
                <div className="space-y-3">
                  <h1 className="max-w-sm text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                    Mark which shifts you can&apos;t work.
                  </h1>
                  <p className="max-w-md text-sm leading-7 text-slate-300 sm:text-base">
                    Every shift starts as available. Tap a whole day to mark all three
                    unavailable, or use the morning, day, and evening toggles to fine-tune it.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Month</p>
                  <p className="mt-2 text-lg font-medium text-white">
                    {formatMonthLabel(visibleMonth)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Unavailable shifts
                  </p>
                  <p className="mt-2 text-lg font-medium text-white">
                    {unavailableShiftCount} shift{unavailableShiftCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-4 py-6 sm:px-6 sm:py-8">
              <form className="space-y-6" onSubmit={handleSubmit}>
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
                    Email for a copy
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

                <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <div className="mb-4 grid grid-cols-3 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleMonthChange(-1)}
                      className="inline-flex h-12 w-full touch-manipulation select-none items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 active:scale-[0.99] cursor-pointer"
                    >
                      Previous
                    </button>
                    <div className="min-w-0 text-center">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                        Availability month
                      </p>
                      <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">
                        {formatMonthLabel(visibleMonth)}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleMonthChange(1)}
                      className="inline-flex h-12 w-full touch-manipulation select-none items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 active:scale-[0.99] cursor-pointer"
                    >
                      Next
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-2 text-center text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-400 sm:text-xs">
                    {WEEKDAYS.map((weekday) => (
                      <div key={weekday} className="py-2">
                        {weekday}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: firstDayOffset }).map((_, index) => (
                      <div
                        key={`empty-${index}`}
                        className="min-h-[7.8rem] rounded-2xl border border-transparent sm:min-h-[8.6rem]"
                        aria-hidden="true"
                      />
                    ))}

                    {days.map((day) => {
                      const dateKey = formatDateKey(day);
                      const statuses = getShiftStatuses(monthAvailability, dateKey);
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
                            "group min-h-[7.8rem] w-full touch-manipulation cursor-pointer select-none rounded-2xl border text-left transition active:scale-[0.98] sm:min-h-[8.6rem]",
                            allUnavailable
                              ? "border-rose-300 bg-rose-100 text-rose-900 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.1)]"
                              : someUnavailable
                                ? "border-amber-300 bg-amber-50 text-slate-900 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.08)]"
                                : "border-slate-200 bg-white text-slate-900 hover:border-sky-300 hover:bg-sky-50",
                          ].join(" ")}
                        >
                          <div className="flex h-full flex-col justify-between p-2 sm:p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span
                                className={[
                                  "text-sm font-semibold sm:text-base",
                                  allUnavailable ? "line-through decoration-2 decoration-rose-500" : "",
                                ].join(" ")}
                              >
                                {day.getDate()}
                              </span>
                              <span
                                className={[
                                  "rounded-full px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.16em]",
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

                            <div className="mt-3 grid grid-cols-3 gap-1.5">
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
                                      "inline-flex h-9 items-center justify-center rounded-xl border text-[0.68rem] font-semibold uppercase tracking-[0.14em] transition active:scale-[0.98]",
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

                            <span className="mt-2 flex items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className={[
                                  "h-2 w-2 rounded-full",
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
                                  "h-0.5 w-3 rounded-full",
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
                                  "h-0.5 w-2 rounded-full",
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

                <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-900">
                    Editing {formatMonthLabel(visibleMonth)}
                  </p>
                  {lastChange ? (
                    <p
                      className={[
                        "mt-1 font-medium",
                        lastChange.tone === "unavailable" ? "text-rose-700" : "text-emerald-700",
                      ].join(" ")}
                    >
                      {lastChange.message}
                    </p>
                  ) : null}
                  <p className="mt-1">
                    {unavailableShiftCount === 0
                      ? "No unavailable shifts selected yet."
                      : `${unavailableShiftCount} unavailable shift${unavailableShiftCount === 1 ? "" : "s"} selected.`}
                  </p>
                  {unavailableShiftSummary.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {unavailableShiftSummary.map((entry) => (
                        <span
                          key={entry.date}
                          className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-rose-700"
                        >
                          {formatReadableDate(entry.date)}: {entry.labels.join(" / ")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-slate-500">
                    Payload includes shift-level availability plus fully unavailable dates for the workflow.
                  </div>
                  <button
                    type="submit"
                    disabled={submitState.status === "submitting" || !staffName.trim()}
                    className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submitState.status === "submitting" ? "Submitting..." : "Submit availability"}
                  </button>
                </div>
              </form>

              {submitState.status === "success" ? (
                <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                  {submitState.message}
                </div>
              ) : null}

              {submitState.status === "error" ? (
                <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                  {submitState.message}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
