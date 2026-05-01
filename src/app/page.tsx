'use client'

import { FormEvent, useMemo, useState } from "react";

const STAFF = ["Amelia Stone", "Jordan Patel", "Maya Chen"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type ChangeState = { message: string; tone: "available" | "unavailable" } | null;

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

export default function Home() {
  const [staffName, setStaffName] = useState("");
  const [email, setEmail] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(getNextMonthStart);
  const [unavailableByMonth, setUnavailableByMonth] = useState<Record<string, string[]>>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [lastChange, setLastChange] = useState<ChangeState>(null);

  const monthKey = formatMonthKey(visibleMonth);
  const unavailableDates = unavailableByMonth[monthKey] ?? [];

  const days = useMemo(() => getDaysInMonth(visibleMonth), [visibleMonth]);
  const firstDayOffset = days[0]?.getDay() ?? 0;

  function handleNameBlur() {
    setStaffName((currentName) => normaliseName(currentName));
  }

  function handleToggle(dateKey: string) {
    setUnavailableByMonth((currentMap) => {
      const currentDates = currentMap[monthKey] ?? [];
      const isCurrentlyUnavailable = currentDates.includes(dateKey);
      const nextDates = currentDates.includes(dateKey)
        ? currentDates.filter((currentDate) => currentDate !== dateKey)
        : [...currentDates, dateKey].sort();

      setLastChange({
        message: `${formatReadableDate(dateKey)} marked ${
          isCurrentlyUnavailable ? "available" : "unavailable"
        }.`,
        tone: isCurrentlyUnavailable ? "available" : "unavailable",
      });

      return {
        ...currentMap,
        [monthKey]: nextDates,
      };
    });

    if (submitState.status !== "idle") {
      setSubmitState({ status: "idle" });
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
                    Mark the days you can&apos;t work.
                  </h1>
                  <p className="max-w-md text-sm leading-7 text-slate-300 sm:text-base">
                    Every date starts as available. Tap any day to mark it unavailable,
                    then submit once the month looks right.
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
                    Unavailable
                  </p>
                  <p className="mt-2 text-lg font-medium text-white">
                    {unavailableDates.length} day{unavailableDates.length === 1 ? "" : "s"}
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
                        className="aspect-square rounded-2xl border border-transparent"
                        aria-hidden="true"
                      />
                    ))}

                    {days.map((day) => {
                      const dateKey = formatDateKey(day);
                      const isUnavailable = unavailableDates.includes(dateKey);

                      return (
                        <button
                          key={dateKey}
                          type="button"
                          aria-pressed={isUnavailable}
                          onClick={() => handleToggle(dateKey)}
                          aria-label={`${day.getDate()} ${isUnavailable ? "Unavailable" : "Available"}`}
                          className={[
                            "group min-h-[4.3rem] w-full touch-manipulation cursor-pointer select-none rounded-2xl border text-left transition active:scale-[0.98] sm:min-h-[5.2rem]",
                            isUnavailable
                              ? "border-rose-300 bg-rose-100 text-rose-900 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.1)]"
                              : "border-slate-200 bg-white text-slate-900 hover:border-sky-300 hover:bg-sky-50",
                          ].join(" ")}
                        >
                          <div className="flex h-full flex-col justify-between p-2 sm:p-3">
                            <span
                              className={[
                                "text-sm font-semibold sm:text-base",
                                isUnavailable ? "line-through decoration-2 decoration-rose-500" : "",
                              ].join(" ")}
                            >
                              {day.getDate()}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className={[
                                  "h-2 w-2 rounded-full",
                                  isUnavailable ? "bg-rose-500" : "bg-emerald-500",
                                ].join(" ")}
                              />
                              <span className="sr-only">
                                {isUnavailable ? "Unavailable" : "Available"}
                              </span>
                              <span
                                aria-hidden="true"
                                className={[
                                  "h-0.5 flex-1 rounded-full",
                                  isUnavailable ? "bg-rose-300" : "bg-emerald-300",
                                ].join(" ")}
                              />
                              <span
                                aria-hidden="true"
                                className={[
                                  "h-0.5 w-3 rounded-full",
                                  isUnavailable ? "bg-rose-300" : "bg-emerald-300",
                                ].join(" ")}
                              />
                              <span
                                aria-hidden="true"
                                className={[
                                  "h-0.5 w-2 rounded-full",
                                  isUnavailable ? "bg-rose-300" : "bg-emerald-300",
                                ].join(" ")}
                              />
                            </span>
                          </div>
                        </button>
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
                    {unavailableDates.length === 0
                      ? "No unavailable dates selected yet."
                      : `${unavailableDates.length} unavailable date${unavailableDates.length === 1 ? "" : "s"} selected.`}
                  </p>
                  {unavailableDates.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {unavailableDates.map((dateKey) => (
                        <span
                          key={dateKey}
                          className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-rose-700"
                        >
                          {formatReadableDate(dateKey)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-slate-500">
                    Payload includes only the unavailable dates for the selected month.
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
