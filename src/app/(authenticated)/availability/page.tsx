import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppPlaceholderPage } from "@/components/app/app-placeholder-page";
import { MonthlyAvailabilityPage } from "@/components/availability/monthly-availability-page";
import { getDefaultPeriodId } from "@/lib/admin/availability";
import { getAuthenticatedAppContext } from "@/lib/authenticated-app";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AvailabilityDayRow,
  AvailabilitySubmissionStatus,
  SchedulePeriodRow,
} from "@/lib/supabase/types";

export const metadata: Metadata = {
  title: "My Availability",
  description: "Monthly staff availability submission for unavailable dates.",
};

type AvailabilityPageProps = {
  searchParams: Promise<{ period?: string }>;
};

type InitialSubmissionState = {
  availabilityByDate: Record<
    string,
    {
      morning: "available" | "unavailable";
      day: "available" | "unavailable";
      evening: "available" | "unavailable";
    }
  >;
  submissionStatus: AvailabilitySubmissionStatus | null;
  willingToWorkAboveTarget: boolean;
  maxExtraShiftsForPeriod: number | null;
};

function mapAvailabilityDays(days: AvailabilityDayRow[]) {
  return Object.fromEntries(
    days.map((day) => [
      day.available_date,
      {
        morning: day.morning ? "available" : "unavailable",
        day: day.day ? "available" : "unavailable",
        evening: day.evening ? "available" : "unavailable",
      },
    ]),
  ) as InitialSubmissionState["availabilityByDate"];
}

async function loadInitialSubmissionState({
  supabase,
  staffId,
  selectedPeriod,
}: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  staffId: string;
  selectedPeriod: SchedulePeriodRow;
}): Promise<InitialSubmissionState> {
  const { data: submission, error: submissionError } = await supabase
    .from("availability_submissions")
    .select(
      "id, status, willing_to_work_above_target, max_extra_shifts_for_period, submitted_at, notes, created_at, updated_at",
    )
    .eq("period_id", selectedPeriod.id)
    .eq("staff_id", staffId)
    .maybeSingle();

  if (submissionError || !submission) {
    return {
      availabilityByDate: {},
      submissionStatus: null,
      willingToWorkAboveTarget: false,
      maxExtraShiftsForPeriod: null,
    };
  }

  const { data: availabilityDays, error: availabilityDaysError } = await supabase
    .from("availability_days")
    .select("id, submission_id, available_date, morning, day, evening, created_at, updated_at")
    .eq("submission_id", submission.id)
    .order("available_date", { ascending: true });

  if (availabilityDaysError) {
    return {
      availabilityByDate: {},
      submissionStatus: submission.status,
      willingToWorkAboveTarget: submission.willing_to_work_above_target,
      maxExtraShiftsForPeriod: submission.max_extra_shifts_for_period,
    };
  }

  return {
    availabilityByDate: mapAvailabilityDays(availabilityDays ?? []),
    submissionStatus: submission.status,
    willingToWorkAboveTarget: submission.willing_to_work_above_target,
    maxExtraShiftsForPeriod: submission.max_extra_shifts_for_period,
  };
}

export default async function AvailabilityPage({ searchParams }: AvailabilityPageProps) {
  const params = await searchParams;
  const context = await getAuthenticatedAppContext();
  const supabase = await getSupabaseServerClient();

  const [{ data: staffMember }, { data: periods, error: periodsError }, { data: staffRoster, error: rosterError }] =
    await Promise.all([
      supabase
        .from("staff_members")
        .select("id, full_name, is_active")
        .eq("profile_id", context.profile.id)
        .maybeSingle(),
      supabase
        .from("schedule_periods")
        .select(
          "id, name, start_date, end_date, availability_deadline, monthly_staff_budget_eur, status, published_at, created_by, created_at, updated_at",
        )
        .in("status", ["collecting_availability", "drafting"])
        .order("start_date", { ascending: true }),
      supabase
        .from("staff_members")
        .select("full_name")
        .eq("is_active", true)
        .order("full_name"),
    ]);

  if (periodsError || !periods) {
    console.error("availability page period load failed", periodsError);

    return (
      <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        Availability could not be loaded right now. Please refresh and try again.
      </section>
    );
  }

  if (!staffMember?.id || !staffMember.is_active) {
    return (
      <AppPlaceholderPage
        eyebrow="My Availability"
        title="Staff access not ready"
        message="Your staff profile is not active for availability submissions yet."
      />
    );
  }

  if (periods.length === 0) {
    return (
      <AppPlaceholderPage
        eyebrow="My Availability"
        title="No availability period open"
        message="No schedule period is currently open for availability submissions."
      />
    );
  }

  const defaultPeriodId = getDefaultPeriodId(periods);
  const selectedPeriodId = periods.some((period) => period.id === params.period)
    ? params.period!
    : defaultPeriodId;

  if (!selectedPeriodId) {
    return (
      <AppPlaceholderPage
        eyebrow="My Availability"
        title="No availability period open"
        message="No schedule period is currently open for availability submissions."
      />
    );
  }

  if (params.period !== selectedPeriodId) {
    redirect(`/availability?period=${selectedPeriodId}`);
  }

  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId);

  if (!selectedPeriod) {
    redirect(`/availability?period=${defaultPeriodId}`);
  }

  const initialSubmission = await loadInitialSubmissionState({
    supabase,
    staffId: staffMember.id,
    selectedPeriod,
  });

  return (
    <MonthlyAvailabilityPage
      key={selectedPeriod.id}
      signedInEmail={context.userEmail}
      initialStaffName={staffMember.full_name ?? ""}
      initialCopyEmail={context.userEmail}
      staffRoster={rosterError ? [] : (staffRoster ?? []).map((row) => row.full_name)}
      periods={periods}
      selectedPeriod={selectedPeriod}
      initialAvailabilityByDate={initialSubmission.availabilityByDate}
      initialSubmissionStatus={initialSubmission.submissionStatus}
      initialWillingToWorkAboveTarget={initialSubmission.willingToWorkAboveTarget}
      initialMaxExtraShiftsForPeriod={initialSubmission.maxExtraShiftsForPeriod}
    />
  );
}
