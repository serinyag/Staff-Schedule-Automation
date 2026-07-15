import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isManagerOrAdmin } from "@/lib/admin/staff";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AvailabilityDayRow, AvailabilitySubmissionRow, ShiftRow } from "@/lib/supabase/types";

type AssignmentCommand =
  | {
      action: "assign";
      periodId: string;
      shiftId: string;
      staffId: string;
    }
  | {
      action: "move";
      periodId: string;
      assignmentId: string;
      targetShiftId: string;
    }
  | {
      action: "remove";
      periodId: string;
      assignmentId: string;
    };

function isAssignmentCommand(value: unknown): value is AssignmentCommand {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;

  if (body.action === "assign") {
    return (
      typeof body.periodId === "string" &&
      typeof body.shiftId === "string" &&
      typeof body.staffId === "string"
    );
  }

  if (body.action === "move") {
    return (
      typeof body.periodId === "string" &&
      typeof body.assignmentId === "string" &&
      typeof body.targetShiftId === "string"
    );
  }

  if (body.action === "remove") {
    return typeof body.periodId === "string" && typeof body.assignmentId === "string";
  }

  return false;
}

async function getAuthorizedManagerSupabase() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null, message: "Please sign in first.", status: 401 };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, app_role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active || !isManagerOrAdmin(profile.app_role)) {
    return {
      supabase,
      user: null,
      message: "You do not have permission to manage schedules.",
      status: 403,
    };
  }

  return { supabase, user, message: null, status: 200 };
}

function getShiftAvailabilityValue(
  row: Pick<AvailabilityDayRow, "morning" | "day" | "evening">,
  shiftType: ShiftRow["shift_type"],
) {
  if (shiftType === "morning") {
    return row.morning;
  }

  if (shiftType === "day") {
    return row.day;
  }

  return row.evening;
}

async function getExplicitUnavailabilityMessage({
  supabase,
  periodId,
  shift,
  staffId,
}: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  periodId: string;
  shift: Pick<ShiftRow, "shift_date" | "shift_type">;
  staffId: string;
}) {
  const { data: submission } = await supabase
    .from("availability_submissions")
    .select(
      "id, period_id, staff_id, status, willing_to_work_above_target, max_extra_shifts_for_period, submitted_at, notes, created_at, updated_at",
    )
    .eq("period_id", periodId)
    .eq("staff_id", staffId)
    .eq("status", "submitted")
    .maybeSingle<AvailabilitySubmissionRow>();

  if (!submission) {
    return null;
  }

  const { data: availabilityDay } = await supabase
    .from("availability_days")
    .select("id, submission_id, available_date, morning, day, evening, created_at, updated_at")
    .eq("submission_id", submission.id)
    .eq("available_date", shift.shift_date)
    .maybeSingle<AvailabilityDayRow>();

  if (!availabilityDay) {
    return null;
  }

  return getShiftAvailabilityValue(availabilityDay, shift.shift_type)
    ? null
    : "This staff member is not available that day.";
}

export async function POST(request: Request) {
  const context = await getAuthorizedManagerSupabase();

  if (!context.user) {
    return NextResponse.json({ message: context.message }, { status: context.status });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Assignment request could not be read." }, { status: 400 });
  }

  if (!isAssignmentCommand(body)) {
    return NextResponse.json({ message: "Assignment request was incomplete." }, { status: 400 });
  }

  const { supabase, user } = context;
  const { data: period } = await supabase
    .from("schedule_periods")
    .select(
      "id, name, start_date, end_date, availability_deadline, status, published_at, created_by, created_at, updated_at",
    )
    .eq("id", body.periodId)
    .maybeSingle();

  if (!period) {
    return NextResponse.json({ message: "The selected schedule period could not be found." }, { status: 404 });
  }

  if (period.status === "published" || period.status === "locked") {
    return NextResponse.json(
      { message: "Published or locked schedules cannot be edited in draft mode." },
      { status: 409 },
    );
  }

  if (body.action === "assign") {
    const { data: targetShift } = await supabase
      .from("shifts")
      .select(
        "id, period_id, shift_date, shift_type, start_time, end_time, required_count, is_optional, notes, created_at, updated_at",
      )
      .eq("id", body.shiftId)
      .maybeSingle<ShiftRow>();

    if (!targetShift || targetShift.period_id !== body.periodId) {
      return NextResponse.json(
        { message: "The selected shift could not be found for this schedule period." },
        { status: 404 },
      );
    }

    const { data: existingAssignment } = await supabase
      .from("shift_assignments")
      .select(
        "id, shift_id, staff_id, status, lifecycle, generation_run_id, assigned_by, assigned_at, manager_note, created_at, updated_at",
      )
      .eq("shift_id", body.shiftId)
      .eq("staff_id", body.staffId)
      .eq("status", "assigned")
      .maybeSingle();

    if (existingAssignment) {
      return NextResponse.json(
        { message: "That staff member is already assigned to this shift." },
        { status: 409 },
      );
    }

    const unavailabilityMessage = await getExplicitUnavailabilityMessage({
      supabase,
      periodId: body.periodId,
      shift: targetShift,
      staffId: body.staffId,
    });

    if (unavailabilityMessage) {
      return NextResponse.json(
        { message: unavailabilityMessage },
        { status: 409 },
      );
    }

    const { error: insertError } = await supabase.from("shift_assignments").insert({
      shift_id: body.shiftId,
      staff_id: body.staffId,
      status: "assigned",
      lifecycle: "draft",
      assigned_by: user.id,
      assigned_at: new Date().toISOString(),
      manager_note: null,
    });

    if (insertError) {
      console.error("assignment insert failed", insertError);
      return NextResponse.json(
        { message: "The assignment could not be saved. Please try again." },
        { status: 500 },
      );
    }

    if (period.status === "collecting_availability") {
      await supabase
        .from("schedule_periods")
        .update({ status: "drafting", updated_at: new Date().toISOString() })
        .eq("id", body.periodId);
    }

    revalidatePath("/admin/schedule");

    return NextResponse.json({ status: "ok", message: "Draft assignment saved." });
  }

  if (body.action === "move") {
    const { data: assignment } = await supabase
      .from("shift_assignments")
      .select(
        "id, shift_id, staff_id, status, lifecycle, generation_run_id, assigned_by, assigned_at, manager_note, created_at, updated_at",
      )
      .eq("id", body.assignmentId)
      .maybeSingle();

    if (!assignment) {
      return NextResponse.json(
        { message: "That assignment could not be found." },
        { status: 404 },
      );
    }

    if (assignment.lifecycle !== "draft" || assignment.status !== "assigned") {
      return NextResponse.json(
        { message: "Only active draft assignments can be moved here." },
        { status: 409 },
      );
    }

    if (assignment.shift_id === body.targetShiftId) {
      return NextResponse.json({ status: "ok", message: "Assignment already in that shift." });
    }

    const { data: targetShift } = await supabase
      .from("shifts")
      .select(
        "id, period_id, shift_date, shift_type, start_time, end_time, required_count, is_optional, notes, created_at, updated_at",
      )
      .eq("id", body.targetShiftId)
      .maybeSingle();

    if (!targetShift || targetShift.period_id !== body.periodId) {
      return NextResponse.json(
        { message: "The target shift could not be found for this schedule period." },
        { status: 404 },
      );
    }

    const { data: existingDestinationAssignment } = await supabase
      .from("shift_assignments")
      .select(
        "id, shift_id, staff_id, status, lifecycle, generation_run_id, assigned_by, assigned_at, manager_note, created_at, updated_at",
      )
      .eq("shift_id", body.targetShiftId)
      .eq("staff_id", assignment.staff_id)
      .eq("status", "assigned")
      .maybeSingle();

    if (existingDestinationAssignment) {
      return NextResponse.json(
        { message: "That staff member is already assigned to the selected shift." },
        { status: 409 },
      );
    }

    const unavailabilityMessage = await getExplicitUnavailabilityMessage({
      supabase,
      periodId: body.periodId,
      shift: targetShift,
      staffId: assignment.staff_id,
    });

    if (unavailabilityMessage) {
      return NextResponse.json(
        { message: unavailabilityMessage },
        { status: 409 },
      );
    }

    const { data: insertedAssignments, error: insertError } = await supabase
      .from("shift_assignments")
      .insert({
        shift_id: body.targetShiftId,
        staff_id: assignment.staff_id,
        status: "assigned",
        lifecycle: "draft",
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
        manager_note: assignment.manager_note,
      })
      .select("id")
      .limit(1);

    if (insertError || !insertedAssignments?.[0]) {
      console.error("assignment move insert failed", insertError);
      return NextResponse.json(
        { message: "The assignment could not be moved. Please try again." },
        { status: 500 },
      );
    }

    const insertedAssignmentId = insertedAssignments[0].id;
    const { error: cancelSourceError } = await supabase
      .from("shift_assignments")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", assignment.id);

    if (cancelSourceError) {
      console.error("assignment move cancellation failed", cancelSourceError);
      await supabase
        .from("shift_assignments")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", insertedAssignmentId);

      return NextResponse.json(
        { message: "The assignment could not be finalized. Please refresh and try again." },
        { status: 500 },
      );
    }

    if (period.status === "collecting_availability") {
      await supabase
        .from("schedule_periods")
        .update({ status: "drafting", updated_at: new Date().toISOString() })
        .eq("id", body.periodId);
    }

    revalidatePath("/admin/schedule");

    return NextResponse.json({ status: "ok", message: "Draft assignment moved." });
  }

  const { data: assignment } = await supabase
    .from("shift_assignments")
    .select(
      "id, shift_id, staff_id, status, lifecycle, generation_run_id, assigned_by, assigned_at, manager_note, created_at, updated_at",
    )
    .eq("id", body.assignmentId)
    .maybeSingle();

  if (!assignment) {
    return NextResponse.json(
      { message: "That assignment was already removed or could not be found." },
      { status: 404 },
    );
  }

  if (assignment.lifecycle !== "draft") {
    return NextResponse.json(
      { message: "Only draft assignments can be removed here." },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase
    .from("shift_assignments")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.assignmentId);

  if (updateError) {
    console.error("assignment removal failed", updateError);
    return NextResponse.json(
      { message: "The assignment could not be removed. Please try again." },
      { status: 500 },
    );
  }

  revalidatePath("/admin/schedule");

  return NextResponse.json({ status: "ok", message: "Draft assignment removed." });
}
