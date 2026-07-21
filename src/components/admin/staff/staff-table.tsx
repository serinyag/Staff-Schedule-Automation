"use client";

import {
  formatAppRoleLabel,
  formatCurrency,
  formatOnboardingIssue,
  formatRoleLabel,
  formatShiftTriple,
  getAuthStateLabel,
  getProfileStateLabel,
  type StaffAdminRecord,
} from "@/lib/admin/staff";
import { StaffOnboardingBadge } from "@/components/admin/staff/staff-onboarding-badge";
import { StaffStatusBadge } from "@/components/admin/staff/staff-status-badge";
import { TrainingPhaseBadge } from "@/components/admin/staff/training-phase-badge";

type StaffTableProps = {
  records: StaffAdminRecord[];
  onEdit: (record: StaffAdminRecord) => void;
};

export function StaffTable({ records, onEdit }: StaffTableProps) {
  if (records.length === 0) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
        <h3 className="text-lg font-semibold text-slate-900">No staff matched this filter</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Try a broader filter or clear the search term to see more staff records.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden xl:block">
        <div className="grid grid-cols-[minmax(15rem,1.35fr)_minmax(15rem,1.2fr)_minmax(14rem,1.1fr)_8rem_10rem_11rem_8rem] gap-4 px-4 pb-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          <span>Staff member</span>
          <span>Onboarding</span>
          <span>Role / rules</span>
          <span>Hourly rate</span>
          <span>Min / target / max</span>
          <span>Training</span>
          <span className="text-right">Action</span>
        </div>

        <div className="space-y-3">
          {records.map((record) => {
            const rolesDiffer = record.workRole !== record.schedulingRuleRole;

            return (
              <div
                key={record.id}
                className="grid grid-cols-[minmax(15rem,1.35fr)_minmax(15rem,1.2fr)_minmax(14rem,1.1fr)_8rem_10rem_11rem_8rem] gap-4 rounded-[1.6rem] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_40px_rgba(15,23,42,0.06)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-slate-950">{record.fullName}</p>
                  {record.email ? (
                    <p className="mt-1 truncate text-sm text-slate-500">{record.email}</p>
                  ) : (
                    <p className="mt-1 text-sm text-amber-700">Email not configured</p>
                  )}
                  <div className="mt-3">
                    <StaffStatusBadge isActive={record.isActive} />
                  </div>
                </div>

                <div className="space-y-2 text-sm text-slate-700">
                  <StaffOnboardingBadge status={record.onboarding.status} />
                  <p className="text-slate-600">{getAuthStateLabel(record)}</p>
                  <p className="text-slate-600">{getProfileStateLabel(record)}</p>
                  <p className="text-slate-600">
                    {record.portal ? formatAppRoleLabel(record.portal.appRole) : "No app access set"}
                  </p>
                  {record.onboarding.issues.length > 0 ? (
                    <ul className="space-y-1 text-xs leading-5 text-amber-800">
                      {record.onboarding.issues.slice(0, 2).map((issue) => (
                        <li key={issue}>{formatOnboardingIssue(issue)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="space-y-1 text-sm text-slate-700">
                  <p>
                    <span className="font-medium text-slate-500">Role:</span>{" "}
                    {formatRoleLabel(record.workRole)}
                  </p>
                  <p>
                    <span className="font-medium text-slate-500">Scheduling rules:</span>{" "}
                    {formatRoleLabel(record.schedulingRuleRole)}
                  </p>
                  {rolesDiffer ? (
                    <p className="text-xs font-medium text-amber-700">
                      Separate budget pool and scheduling rules
                    </p>
                  ) : null}
                </div>

                <p className="text-sm font-semibold text-slate-900">{formatCurrency(record.hourlyRate)}</p>
                <p className="text-sm font-semibold text-slate-900">{formatShiftTriple(record)}</p>
                <div>
                  <TrainingPhaseBadge training={record.training} />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onEdit(record)}
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 xl:hidden">
        {records.map((record) => {
          const rolesDiffer = record.workRole !== record.schedulingRuleRole;

          return (
            <article
              key={record.id}
              className="rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
            >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-xl font-semibold text-slate-950">{record.fullName}</h3>
                    {record.email ? (
                      <p className="mt-1 truncate text-sm text-slate-500">{record.email}</p>
                    ) : (
                      <p className="mt-1 text-sm text-amber-700">Email not configured</p>
                    )}
                    <div className="mt-3">
                      <StaffStatusBadge isActive={record.isActive} />
                    </div>
                </div>

                <button
                  type="button"
                  onClick={() => onEdit(record)}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  Edit
                </button>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Onboarding
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StaffOnboardingBadge status={record.onboarding.status} />
                    <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                      {getAuthStateLabel(record)}
                    </span>
                    <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                      {getProfileStateLabel(record)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-700">
                    <span className="font-medium text-slate-500">App access:</span>{" "}
                    {record.portal ? formatAppRoleLabel(record.portal.appRole) : "Not configured"}
                  </p>
                  {record.onboarding.issues.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm leading-6 text-amber-800">
                      {record.onboarding.issues.slice(0, 3).map((issue) => (
                        <li key={issue}>{formatOnboardingIssue(issue)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Role setup
                  </p>
                  <p className="mt-3 text-sm text-slate-700">
                    <span className="font-medium text-slate-500">Role:</span>{" "}
                    {formatRoleLabel(record.workRole)}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    <span className="font-medium text-slate-500">Scheduling rules:</span>{" "}
                    {formatRoleLabel(record.schedulingRuleRole)}
                  </p>
                  {rolesDiffer ? (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      Separate budget pool and scheduling rules
                    </p>
                  ) : null}
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Weekly shifts
                  </p>
                  <p className="mt-3 text-sm font-semibold text-slate-900">{formatShiftTriple(record)}</p>
                  <p className="mt-3 text-sm text-slate-700">
                    <span className="font-medium text-slate-500">Hourly rate:</span>{" "}
                    {formatCurrency(record.hourlyRate)}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Training
                  </p>
                  <div className="mt-3">
                    <TrainingPhaseBadge training={record.training} />
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
