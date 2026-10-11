import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./shared";

export async function sendPasswordReset(email: string, redirectTo: string) {
  const { url, key } = getSupabasePublicEnv();
  // Recovery emails must work in another browser. This request-only client
  // sends no PKCE challenge and never reads or changes the app's login session.
  // Completion verifies the emailed session with Auth before showing the form.
  const recoveryClient = createClient(url, key, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "staff-password-recovery-request",
    },
  });
  return recoveryClient.auth.resetPasswordForEmail(email, { redirectTo });
}
