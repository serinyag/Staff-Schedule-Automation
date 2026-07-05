import { cache } from "react";
import { redirect } from "next/navigation";
import { getProfileLabel, isManagerOrAdmin } from "@/lib/admin/staff";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AppRole, ProfileRow } from "@/lib/supabase/types";

export type AppNavItem = {
  href: string;
  label: string;
};

export type AuthenticatedAppContext = {
  userEmail: string;
  profile: ProfileRow;
  profileLabel: string;
  managementItems: AppNavItem[];
  employeeItems: AppNavItem[];
};

export const MANAGEMENT_NAV_ITEMS: AppNavItem[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/availability", label: "Team Availability" },
  { href: "/admin/schedule", label: "Schedule" },
];

export const EMPLOYEE_NAV_ITEMS: AppNavItem[] = [
  { href: "/availability", label: "My Availability" },
  { href: "/my-schedule", label: "My Schedule" },
];

export function getDefaultSignedInPath(role: AppRole) {
  return isManagerOrAdmin(role) ? "/admin" : "/availability";
}

function hasSupportedRole(role: AppRole | null | undefined): role is AppRole {
  return role === "admin" || role === "manager" || role === "staff";
}

export const getAuthenticatedAppContext = cache(async (): Promise<AuthenticatedAppContext> => {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, app_role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active || !hasSupportedRole(profile.app_role)) {
    redirect("/unauthorized");
  }

  return {
    userEmail: user.email ?? "Signed-in user",
    profile,
    profileLabel: getProfileLabel(profile),
    managementItems: isManagerOrAdmin(profile.app_role) ? MANAGEMENT_NAV_ITEMS : [],
    employeeItems: EMPLOYEE_NAV_ITEMS,
  };
});

export async function requireManagerOrAdmin() {
  const context = await getAuthenticatedAppContext();

  if (!isManagerOrAdmin(context.profile.app_role)) {
    redirect("/unauthorized?reason=role");
  }

  return context;
}

export function normalizeNextPath(path: string | undefined) {
  if (!path || !path.startsWith("/")) {
    return "/auth/redirect";
  }

  return path;
}
