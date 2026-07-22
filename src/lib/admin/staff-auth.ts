import type { User } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service";
import type { StaffAuthUserRecord } from "@/lib/admin/staff-onboarding";

const LIST_USERS_PAGE_SIZE = 200;

export async function findAuthUserByNormalizedEmail(normalizedEmail: string) {
  if (!normalizedEmail) {
    return null;
  }

  const serviceClient = getSupabaseServiceRoleClient();
  let page = 1;

  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Supabase auth lookup failed: ${error.message}`);
    }

    const users = data.users ?? [];
    const matchingUser = users.find(
      (user) => normalizeEmail(user.email) === normalizedEmail,
    );

    if (matchingUser) {
      return mapAuthUser(matchingUser);
    }

    if (users.length < LIST_USERS_PAGE_SIZE) {
      return null;
    }

    page += 1;
  }
}

export async function listAuthUsersByNormalizedEmails(normalizedEmails: string[]) {
  const emailSet = new Set(normalizedEmails.filter(Boolean));

  if (emailSet.size === 0) {
    return new Map<string, StaffAuthUserRecord>();
  }

  const serviceClient = getSupabaseServiceRoleClient();
  const authUsers = new Map<string, StaffAuthUserRecord>();
  let page = 1;

  while (authUsers.size < emailSet.size) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Supabase auth lookup failed: ${error.message}`);
    }

    const users = data.users ?? [];

    for (const user of users) {
      const normalizedEmail = normalizeEmail(user.email);

      if (normalizedEmail && emailSet.has(normalizedEmail) && !authUsers.has(normalizedEmail)) {
        authUsers.set(normalizedEmail, mapAuthUser(user));
      }
    }

    if (users.length < LIST_USERS_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return authUsers;
}

export async function inviteAuthUserByEmail(email: string, redirectTo: string) {
  const serviceClient = getSupabaseServiceRoleClient();
  const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (error) {
    throw error;
  }

  return data.user ? mapAuthUser(data.user) : null;
}

export function sanitizeInvitationErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("already") || normalizedMessage.includes("exists")) {
    return "An account already exists for this email address.";
  }

  if (normalizedMessage.includes("rate")) {
    return "Supabase rate-limited invitation delivery. Please try again shortly.";
  }

  return "Supabase could not send the invitation email right now.";
}

function mapAuthUser(user: User): StaffAuthUserRecord {
  return {
    id: user.id,
    email: user.email ?? "",
    emailConfirmedAt: user.email_confirmed_at ?? null,
    invitedAt: user.invited_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    createdAt: user.created_at ?? null,
  };
}

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}
