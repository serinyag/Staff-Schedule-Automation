import { NextResponse } from "next/server";
import { parseAssignmentBlockers } from "@/lib/admin/schedule";
import { isManagerOrAdmin } from "@/lib/admin/staff";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    shiftId: string;
  }>;
};

function getShiftAvailabilityValue(row: { morning: boolean; day: boolean; evening: boolean }, shiftType: string) {
  if (shiftType === "morning") return row.morning;
  if (shiftType === "day") return row.day;
  return row.evening;
}

export async function GET(_request: Request, context: RouteContext) {
  const { shiftId } = await context.params;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ message: "Please sign in first." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, app_role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active || !isManagerOrAdmin(profile.app_role)) {
    return NextResponse.json({ message: "You do not have permission to view schedule candidates." }, { status: 403 });
  }

  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select(
      "id, period_id, shift_date, shift_type, start_time, end_time, required_count, is_optional, notes, created_at, updated_at",
    )
    .eq("id", shiftId)
    .maybeSingle();

  if (shiftError || !shift) {
    return NextResponse.json({ message: "The selected shift could not be found." }, { status: 404 });
  }

  const [{ data: activeStaff }, { data: assignments }, { data: submissions }] = await Promise.all([
    supabase
      .from("staff_members")
      .select(
        "id, profile_id, full_name, work_role, scheduling_rule_role, hourly_rate, is_active, is_wildcard_fill_in, is_initial_training_mentor, default_weekly_budget_shifts, created_at, updated_at",
      )
      .eq("is_active", true)
      .order("full_name"),
    supabase
      .from("shift_assignments")
      .select(
        "id, shift_id, staff_id, status, lifecycle, generation_run_id, assigned_by, assigned_at, manager_note, created_at, updated_at",
      )
      .eq("shift_id", shift.id)
      .eq("status", "assigned"),
    supabase
      .from("availability_submissions")
      .select(
        "id, period_id, staff_id, status, willing_to_work_above_target, max_extra_shifts_for_period, submitted_at, notes, created_at, updated_at",
      )
      .eq("period_id", shift.period_id),
  ]);

  const assignedStaffIds = new Set((assignments ?? []).map((assignment) => assignment.staff_id));
  const submittedByStaffId = new Map(
    (submissions ?? [])
      .filter((submission) => submission.status === "submitted")
      .map((submission) => [submission.staff_id, submission.id]),
  );
  const submissionIds = Array.from(submittedByStaffId.values());

  const availabilityDaysResult = submissionIds.length
    ? await supabase
        .from("availability_days")
        .select("id, submission_id, available_date, morning, day, evening, created_at, updated_at")
        .eq("available_date", shift.shift_date)
        .in("submission_id", submissionIds)
    : { data: [] };

  const availabilityBySubmissionId = new Map(
    (availabilityDaysResult.data ?? []).map((row) => [row.submission_id, row]),
  );

  const candidates = await Promise.all(
    (activeStaff ?? []).map(async (staff) => {
      if (assignedStaffIds.has(staff.id)) {
        return null;
      }

      const submissionId = submittedByStaffId.get(staff.id);

      if (!submissionId) {
        return {
          group: "unavailable" as const,
          staffId: staff.id,
          staffName: staff.full_name,
          workRole: staff.work_role,
          reasons: ["Availability has not been submitted for this period."],
        };
      }

      const availability = availabilityBySubmissionId.get(submissionId);

      if (!availability || getShiftAvailabilityValue(availability, shift.shift_type) !== true) {
        return {
          group: "unavailable" as const,
          staffId: staff.id,
          staffName: staff.full_name,
          workRole: staff.work_role,
          reasons: ["This staff member is unavailable for the selected shift."],
        };
      }

      const blockerResult = await supabase.rpc("assignment_blockers", {
        p_staff_id: staff.id,
        p_shift_id: shift.id,
      });
      const blockers = parseAssignmentBlockers((blockerResult.data ?? null) as never);

      if (blockers.length > 0) {
        return {
          group: "blocked" as const,
          staffId: staff.id,
          staffName: staff.full_name,
          workRole: staff.work_role,
          reasons: blockers.map((blocker) => blocker.message),
        };
      }

      return {
        group: "eligible" as const,
        staffId: staff.id,
        staffName: staff.full_name,
        workRole: staff.work_role,
        reasons: [] as string[],
      };
    }),
  );

  return NextResponse.json({
    shift: {
      id: shift.id,
      dateKey: shift.shift_date,
      shiftType: shift.shift_type,
      startTime: shift.start_time,
      endTime: shift.end_time,
      requiredCount: shift.required_count,
    },
    currentAssignments: (assignments ?? [])
      .map((assignment) => {
        const staff = (activeStaff ?? []).find((row) => row.id === assignment.staff_id);

        return {
          id: assignment.id,
          staffId: assignment.staff_id,
          staffName: staff?.full_name ?? "Unknown staff",
          lifecycle: assignment.lifecycle,
        };
      })
      .sort((left, right) => left.staffName.localeCompare(right.staffName)),
    eligible: candidates.filter((candidate) => candidate?.group === "eligible"),
    blocked: candidates.filter((candidate) => candidate?.group === "blocked"),
    unavailable: candidates.filter((candidate) => candidate?.group === "unavailable"),
  });
}
