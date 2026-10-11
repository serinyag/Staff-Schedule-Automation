import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeNextPath } from "@/lib/authenticated-app";
import { getSupabasePublicEnv } from "@/lib/supabase/shared";
import type { Database } from "@/lib/supabase/types";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const nextPath = normalizeNextPath(requestUrl.searchParams.get("next") ?? "/auth/redirect");
  const code = requestUrl.searchParams.get("code");
  const flowId = requestUrl.searchParams.get("sb_flow_id") ?? undefined;

  // Invitation and recovery links return session tokens in the URL fragment.
  // The browser carries that fragment through this redirect to the client page.
  if (!code) {
    return NextResponse.redirect(new URL("/auth/complete", request.url));
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  const { url, key } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code, { flowId });
    if (error) {
      const destination = new URL("/auth/complete", request.url);
      const safeCodes = ["pkce_code_verifier_not_found", "bad_code_verifier", "otp_expired", "flow_state_expired", "flow_state_not_found"];
      destination.searchParams.set("error_code", safeCodes.includes(error.code ?? "") ? error.code! : "verification_failed");
      if (nextPath === "/auth/complete?mode=recovery") destination.searchParams.set("mode", "recovery");
      response.headers.set("Location", destination.toString());
      return response;
    }
  }

  return response;
}
