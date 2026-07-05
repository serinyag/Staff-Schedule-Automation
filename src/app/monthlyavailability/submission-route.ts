import type { AvailabilitySubmissionStatus } from "@/lib/supabase/types";

export const runtime = "nodejs";

type ShiftAvailabilityEntry = {
  date: string;
  morning: "available" | "unavailable";
  day: "available" | "unavailable";
  evening: "available" | "unavailable";
};

type UnavailableShiftEntry = {
  date: string;
  shifts: string[];
  labels: string[];
};

export type AvailabilitySubmissionRequest = {
  period_id: string;
  period_name: string;
  submission_status: AvailabilitySubmissionStatus;
  staff_name: string;
  email: string;
  month: string;
  willing_to_work_above_target: boolean;
  max_extra_shifts_for_period: number | null;
  unavailable_dates: string[];
  unavailable_shifts: UnavailableShiftEntry[];
  shift_availability: ShiftAvailabilityEntry[];
};
