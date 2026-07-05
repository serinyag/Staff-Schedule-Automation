import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AvailabilitySubmissionRequest } from "@/app/monthlyavailability/submission-route";
import type { AvailabilitySubmissionStatus } from "@/lib/supabase/types";

export const runtime = "nodejs";

const SUBMITTABLE_PERIOD_STATUSES = new Set(["collecting_availability", "drafting"]);
const SHIFT_STATUS_VALUES = new Set(["available", "unavailable"]);

type ShiftAvailabilityEntry = AvailabilitySubmissionRequest["shift_availability"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isShiftStatus(value: unknown): value is "available" | "unavailable" {
  return typeof value === "string" && SHIFT_STATUS_VALUES.has(value);
}

function isAvailabilitySubmissionStatus(value: unknown): value is AvailabilitySubmissionStatus {
  return value === "draft" || value === "submitted";
}

function isValidShiftAvailabilityEntry(value: unknown): value is ShiftAvailabilityEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.date === "string" &&
    isIsoDate(value.date) &&
    isShiftStatus(value.morning) &&
    isShiftStatus(value.day) &&
    isShiftStatus(value.evening)
  );
}

function isValidSubmissionBody(value: unknown): value is AvailabilitySubmissionRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.period_id === "string" &&
    typeof value.period_name === "string" &&
    isAvailabilitySubmissionStatus(value.submission_status) &&
    typeof value.staff_name === "string" &&
    typeof value.email === "string" &&
    typeof value.month === "string" &&
    typeof value.willing_to_work_above_target === "boolean" &&
    (typeof value.max_extra_shifts_for_period === "number" ||
      value.max_extra_shifts_for_period === null) &&
    Array.isArray(value.unavailable_dates) &&
    value.unavailable_dates.every((entry) => typeof entry === "string" && isIsoDate(entry)) &&
    Array.isArray(value.unavailable_shifts) &&
    Array.isArray(value.shift_availability) &&
    value.shift_availability.every(isValidShiftAvailabilityEntry)
  );
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateKeysInRange(startDate: string, endDate: string) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const keys: string[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    keys.push(formatDateKey(cursor));
  }

  return keys;
}

function normalizeShiftValue(value: "available" | "unavailable") {
  return value === "available";
}

function buildUnavailableShiftSummary(shiftAvailability: ShiftAvailabilityEntry[]) {
  return shiftAvailability
    .map((entry) => {
      const shifts = [
        entry.morning === "unavailable" ? "morning" : null,
        entry.day === "unavailable" ? "day" : null,
        entry.evening === "unavailable" ? "evening" : null,
      ].filter((value): value is "morning" | "day" | "evening" => value !== null);

      if (shifts.length === 0) {
        return null;
      }

      return {
        date: entry.date,
        shifts,
        labels: shifts.map((shift) =>
          shift === "morning" ? "Morning" : shift === "day" ? "Day" : "Evening",
        ),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function getSubmissionErrorStatus(error: { code?: string; message?: string }) {
  if (error.code === "42501") {
    return 403;
  }

  if (error.code === "P0002") {
    return 404;
  }

  if (error.code === "P0001") {
    return 400;
  }

  return 500;
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { message: "Please sign in before submitting availability." },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Submission payload could not be read." },
      { status: 400 },
    );
  }

  if (!isValidSubmissionBody(body)) {
    return NextResponse.json(
      { message: "Submission payload was incomplete." },
      { status: 400 },
    );
  }

  const dateKeys = body.shift_availability.map((entry) => entry.date);
  const uniqueDateKeys = new Set(dateKeys);

  if (uniqueDateKeys.size !== dateKeys.length) {
    return NextResponse.json(
      { message: "Submission payload contains duplicate dates." },
      { status: 400 },
    );
  }

  const { data: period, error: periodError } = await supabase
    .from("schedule_periods")
    .select("id, name, start_date, end_date, status")
    .eq("id", body.period_id)
    .maybeSingle();

  if (periodError || !period) {
    return NextResponse.json(
      { message: "The selected schedule period could not be found." },
      { status: 404 },
    );
  }

  if (!SUBMITTABLE_PERIOD_STATUSES.has(period.status)) {
    return NextResponse.json(
      { message: "This schedule period is no longer accepting availability updates." },
      { status: 409 },
    );
  }

  const expectedDateKeys = getDateKeysInRange(period.start_date, period.end_date);

  if (
    body.shift_availability.length !== expectedDateKeys.length ||
    expectedDateKeys.some((dateKey) => !uniqueDateKeys.has(dateKey))
  ) {
    return NextResponse.json(
      { message: "Submission payload did not include the full schedule period." },
      { status: 400 },
    );
  }

  const rpcPayload = body.shift_availability.map((entry) => ({
    available_date: entry.date,
    morning: normalizeShiftValue(entry.morning),
    day: normalizeShiftValue(entry.day),
    evening: normalizeShiftValue(entry.evening),
  }));

  const { data: submissionId, error: submissionError } = await supabase.rpc(
    "submit_staff_availability",
    {
      p_period_id: body.period_id,
      p_status: body.submission_status,
      p_willing_to_work_above_target: body.willing_to_work_above_target,
      p_max_extra_shifts_for_period: body.max_extra_shifts_for_period,
      p_daily_availability: rpcPayload,
    },
  );

  if (submissionError || !submissionId) {
    console.error("availability rpc failed", submissionError);

    return NextResponse.json(
      {
        message:
          submissionError?.message ?? "We couldn't save your availability right now. Please try again.",
      },
      { status: getSubmissionErrorStatus(submissionError ?? {}) },
    );
  }

  const webhookUrl = process.env.N8N_AVAILABILITY_WEBHOOK_URL;
  const unavailableShiftSummary = buildUnavailableShiftSummary(body.shift_availability);
  const unavailableDates = unavailableShiftSummary
    .filter((entry) => entry.shifts.length === 3)
    .map((entry) => entry.date);

  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          period_id: body.period_id,
          period_name: body.period_name || period.name,
          submission_id: submissionId,
          submission_status: body.submission_status,
          staff_name: body.staff_name,
          email: body.email,
          month: body.month,
          unavailable_dates: unavailableDates,
          unavailable_shifts: unavailableShiftSummary,
          shift_availability: body.shift_availability,
          willing_to_work_above_target: body.willing_to_work_above_target,
          max_extra_shifts_for_period: body.max_extra_shifts_for_period,
          submitted_at:
            body.submission_status === "submitted" ? new Date().toISOString() : null,
          submitted_by: {
            user_id: user.id,
            login_email: user.email ?? null,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }
    } catch (error) {
      console.error("availability webhook forward failed", error);
    }
  }

  return NextResponse.json({
    status: "received",
    submission_id: submissionId,
    submission_status: body.submission_status,
    saved_to_supabase: true,
    webhook_forwarded: Boolean(webhookUrl),
  });
}
