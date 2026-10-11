import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isDayShiftCommand } from "@/lib/admin/schedule-commands";
import { authorizedScheduleManager, readScheduleCommand, scheduleError } from "@/lib/server/schedule-http";
export async function POST(request: Request) {
  const context=await authorizedScheduleManager();
  if (context.status!==200) return NextResponse.json({message:context.message},{status:context.status});
  let body:unknown;
  try { body=await readScheduleCommand(request); } catch { return NextResponse.json({message:"Invalid day-shift request."},{status:400}); }
  if (!isDayShiftCommand(body)) return NextResponse.json({message:"Invalid day-shift request."},{status:400});
  const {error}=await context.supabase.rpc("edit_schedule_day_shift",{
    p_period_id:body.periodId,p_action:body.action,p_date:body.dateKey||null,p_shift_id:body.shiftId||null,
  });
  if (error) { const result=scheduleError(error); return NextResponse.json({message:result.message},{status:result.status}); }
  revalidatePath("/admin/schedule");
  return NextResponse.json({status:"ok",message:body.action==="create"?"Day shift added.":"Day shift removed."});
}
