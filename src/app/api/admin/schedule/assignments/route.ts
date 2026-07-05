import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { parseAssignmentBlockers } from "@/lib/admin/schedule";
import { isManagerOrAdmin } from "@/lib/admin/staff";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type AssignmentCommand =
  | {
      action: "assign";
      periodId: string;
      shiftId: string;
      staffId: string;
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

    const blockerResult = await supabase.rpc("assignment_blockers", {
      p_staff_id: body.staffId,
      p_shift_id: body.shiftId,
    });
    const blockers = parseAssignmentBlockers((blockerResult.data ?? null) as never);

    if (blockers.length > 0) {
      return NextResponse.json(
        { message: blockers.map((blocker) => blocker.message).join(" ") },
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
