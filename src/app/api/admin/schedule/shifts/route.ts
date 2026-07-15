import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isManagerOrAdmin } from "@/lib/admin/staff";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type CreateShiftCommand = {
  action: "create";
  periodId: string;
  dateKey: string;
  shiftType: "day";
};

type DeleteShiftCommand = {
  action: "delete";
  periodId: string;
  shiftId: string;
};

type ShiftCommand = CreateShiftCommand | DeleteShiftCommand;

function isShiftCommand(value: unknown): value is ShiftCommand {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;

  if (body.action === "create") {
    return (
      typeof body.periodId === "string" &&
      typeof body.dateKey === "string" &&
      body.shiftType === "day"
    );
  }

  if (body.action === "delete") {
    return typeof body.periodId === "string" && typeof body.shiftId === "string";
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
      message: "You do not have permission to manage shifts.",
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
    return NextResponse.json({ message: "Shift request could not be read." }, { status: 400 });
  }

  if (!isShiftCommand(body)) {
    return NextResponse.json({ message: "Shift request was incomplete." }, { status: 400 });
  }

  const { supabase } = context;
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
      { message: "Published or locked schedules cannot be edited." },
      { status: 409 },
    );
  }

  if (body.action === "create") {
    if (body.dateKey < period.start_date || body.dateKey > period.end_date) {
      return NextResponse.json(
        { message: "That date is outside the selected schedule period." },
        { status: 409 },
      );
    }

    const { data: existingShift } = await supabase
      .from("shifts")
      .select("id")
      .eq("period_id", body.periodId)
      .eq("shift_date", body.dateKey)
      .eq("shift_type", body.shiftType)
      .maybeSingle();

    if (existingShift) {
      return NextResponse.json({ status: "ok", message: "A day shift already exists for that date." });
    }

    const { error: insertError } = await supabase.from("shifts").insert({
      period_id: body.periodId,
      shift_date: body.dateKey,
      shift_type: body.shiftType,
      start_time: null,
      end_time: null,
      required_count: 1,
      is_optional: true,
      notes: null,
    });

    if (insertError) {
      console.error("day shift insert failed", insertError);
      return NextResponse.json(
        { message: "The day shift could not be created right now. Please try again." },
        { status: 500 },
      );
    }

    revalidatePath("/admin/schedule");

    return NextResponse.json({ status: "ok", message: "Day shift added." });
  }

  const { data: shift } = await supabase
    .from("shifts")
    .select(
      "id, period_id, shift_date, shift_type, start_time, end_time, required_count, is_optional, notes, created_at, updated_at",
    )
    .eq("id", body.shiftId)
    .maybeSingle();

  if (!shift || shift.period_id !== body.periodId) {
    return NextResponse.json({ message: "That shift could not be found." }, { status: 404 });
  }

  if (shift.shift_type !== "day") {
    return NextResponse.json({ message: "Only day shifts can be removed here." }, { status: 409 });
  }

  const { data: activeAssignments } = await supabase
    .from("shift_assignments")
    .select("id")
    .eq("shift_id", shift.id)
    .eq("status", "assigned");

  if ((activeAssignments ?? []).length > 0) {
    return NextResponse.json(
      { message: "Remove assignments from this day shift before deleting it." },
      { status: 409 },
    );
  }

  const { error: deleteError } = await supabase
    .from("shifts")
    .delete()
    .eq("id", shift.id);

  if (deleteError) {
    console.error("day shift delete failed", deleteError);
    return NextResponse.json(
      { message: "The day shift could not be removed right now. Please try again." },
      { status: 500 },
    );
  }

  revalidatePath("/admin/schedule");

  return NextResponse.json({ status: "ok", message: "Day shift removed." });
}
