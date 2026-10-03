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
  const { error: openingError } = await supabase.rpc("ensure_monthly_schedule_period", {});
  if (openingError) throw new Error("Could not open monthly availability. Please refresh.");

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
          "id, name, start_date, end_date, availability_deadline, monthly_staff_budget_eur, availability_revision, validated_availability_revision, status, published_at, created_by, created_at, updated_at",
        )
        .in("status", ["collecting_availability", "drafting", "published"])
        .gte("end_date", new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date()))
        .lte("start_date", new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth() + 1, 1)).toISOString().slice(0, 10))
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
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm leading-7 text-rose-800 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
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

  const { data: revisions } = await supabase.from("availability_revisions").select("*")
    .eq("period_id", selectedPeriod.id).eq("staff_id", staffMember.id).order("created_at", { ascending: false }).limit(20);
  const latest = revisions?.[0];
  if (latest && ["draft", "pending"].includes(latest.kind) && Array.isArray(latest.daily_availability)) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
    const editableDays = (latest.daily_availability as AvailabilityDayRow[]).filter(day => day.available_date >= today);
    initialSubmission.availabilityByDate = { ...initialSubmission.availabilityByDate, ...mapAvailabilityDays(editableDays) };
  }

  return (
    <MonthlyAvailabilityPage
      key={selectedPeriod.id}
      revisions={revisions ?? []}
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
