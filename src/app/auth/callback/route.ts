import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeNextPath } from "@/lib/authenticated-app";
import { getSupabasePublicEnv } from "@/lib/supabase/shared";
import type { Database } from "@/lib/supabase/types";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const nextPath = normalizeNextPath(requestUrl.searchParams.get("next") ?? "/auth/redirect");
  const code = requestUrl.searchParams.get("code");

  // Invitation and recovery links return session tokens in the URL fragment.
  // The browser carries that fragment through this redirect to the client page.
  if (!code) {
    return NextResponse.redirect(new URL("/auth/complete", request.url));
  }

  let response = NextResponse.redirect(new URL(nextPath, request.url));
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

        response = NextResponse.redirect(new URL(nextPath, request.url));

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/auth/complete", request.url));
    }
  }

  return response;
}
