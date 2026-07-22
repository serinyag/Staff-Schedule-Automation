"use client";

import { formatOnboardingStatus } from "@/lib/admin/staff";
import type { StaffOnboardingStatus } from "@/lib/admin/staff-onboarding";

const STATUS_STYLES: Record<StaffOnboardingStatus, string> = {
  incomplete_setup: "bg-amber-100 text-amber-900",
  ready_to_invite: "bg-sky-100 text-sky-900",
  invitation_pending: "bg-indigo-100 text-indigo-900",
  invitation_failed: "bg-rose-100 text-rose-900",
  active: "bg-emerald-100 text-emerald-900",
  login_inactive: "bg-slate-200 text-slate-700",
  scheduling_inactive: "bg-orange-100 text-orange-900",
  deactivated: "bg-slate-300 text-slate-800",
};

export function StaffOnboardingBadge({ status }: { status: StaffOnboardingStatus }) {
  return (
    <span
      className={[
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
        STATUS_STYLES[status],
      ].join(" ")}
    >
      {formatOnboardingStatus(status)}
    </span>
  );
}
