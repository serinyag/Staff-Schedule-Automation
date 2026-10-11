"use server";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
export async function reviewAvailabilityRequest(id: string, approve: boolean, note: string) {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("review_availability_request", { p_request_id: id, p_approve: approve, p_note: note.slice(0, 1000) });
  if (error) return error.message;
  revalidatePath("/admin/availability"); revalidatePath("/availability"); revalidatePath("/admin/schedule");
  return approve ? "Change request approved." : "Change request rejected. Existing availability is unchanged.";
}
