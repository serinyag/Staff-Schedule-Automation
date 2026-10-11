import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAssignmentCommand } from "@/lib/admin/schedule-commands";
import { authorizedScheduleManager, readScheduleCommand, scheduleError } from "@/lib/server/schedule-http";
export async function POST(request: Request) {
  const context = await authorizedScheduleManager();
  if (context.status !== 200) return NextResponse.json({message:context.message},{status:context.status});
  let body: unknown;
  try { body = await readScheduleCommand(request); }
  catch { return NextResponse.json({message:"Invalid assignment request."},{status:400}); }
  if (!isAssignmentCommand(body)) return NextResponse.json({message:"Invalid assignment request."},{status:400});
  const {data:staff}=body.action==='assign'&&body.staffId ? await context.supabase.from('staff_members').select('is_wildcard_fill_in').eq('id',body.staffId).maybeSingle():{data:null};
  const { error } = staff?.is_wildcard_fill_in
    ? await context.supabase.rpc('assign_wildcard_cover',{p_period_id:body.periodId,p_shift_id:body.shiftId!,p_staff_id:body.staffId!})
    : await context.supabase.rpc("edit_schedule_assignment", {
    p_period_id:body.periodId, p_action:body.action, p_shift_id:body.shiftId || body.targetShiftId || null,
    p_staff_id:body.staffId || null, p_assignment_id:body.assignmentId || null,
  });
  if (error) { const result=scheduleError(error); return NextResponse.json({message:result.message},{status:result.status}); }
  revalidatePath("/admin/schedule");
  return NextResponse.json({status:"ok",message:"Draft assignment saved."});
}
