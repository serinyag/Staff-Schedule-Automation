import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isManagerOrAdmin } from "@/lib/admin/staff";
export async function authorizedScheduleManager() {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, status: 401, message: "Please sign in first." };
  const { data: profile, error: profileError } = await supabase.from("profiles").select("app_role,is_active").eq("id",user.id).maybeSingle();
  return profileError || !profile?.is_active || !isManagerOrAdmin(profile.app_role)
    ? { supabase, status: 403, message: "You do not have permission to manage schedules." }
    : { supabase, status: 200, message: "" };
}
export {readScheduleCommand} from "@/lib/admin/schedule-http-guard";
export function scheduleError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return { status: 403, message: "You do not have permission to manage schedules." };
  if (error.code === "P0002") return { status: 404, message: "That item could not be found in this schedule." };
  if (error.code === "P0001") return { status: 409, message: error.message || "The schedule changed. Refresh and try again." };
  console.error(JSON.stringify({ event: "schedule.mutation_failed", code: error.code || "unknown" }));
  return { status: 500, message: "The change could not be saved. Please try again." };
}
