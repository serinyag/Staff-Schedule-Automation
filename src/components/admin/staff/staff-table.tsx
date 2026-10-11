"use client";

import { formatCurrency, formatOnboardingIssue, formatRoleLabel, formatShiftTriple, getAuthStateLabel, type StaffAdminRecord } from "@/lib/admin/staff";
import { StaffOnboardingBadge } from "@/components/admin/staff/staff-onboarding-badge";
import { StaffStatusBadge } from "@/components/admin/staff/staff-status-badge";
import { TrainingPhaseBadge } from "@/components/admin/staff/training-phase-badge";

type StaffTableProps = { records: StaffAdminRecord[]; onEdit: (record: StaffAdminRecord) => void };

export function StaffTable({ records, onEdit }: StaffTableProps) {
  if (!records.length) return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <h3 className="text-base font-semibold">No staff matched this filter</h3>
      <p className="mt-2 text-sm text-slate-600">Try another filter or clear your search.</p>
    </div>
  );
  return (
    <div className="@container">
      <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_4rem] gap-4 px-4 py-3 text-xs font-medium text-slate-500 @[800px]:grid">
        <span>Staff member</span><span>Account setup</span><span>Contract</span><span>Training</span><span className="text-right">Edit</span>
      </div>
      <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
        {records.map((record) => (
          <article key={record.id} className="grid min-w-0 grid-cols-2 gap-4 bg-white p-4 transition hover:bg-slate-50/60 @[800px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_4rem] @[800px]:items-start">
            <div className="col-span-2 min-w-0 @[800px]:col-span-1">
              <h3 className="break-words text-sm font-semibold text-slate-950">{record.fullName}</h3>
              <p className="mt-1 break-all text-xs text-slate-500">{record.email || "No email added"}</p>
              <p className="mt-2 text-xs text-slate-600">{formatRoleLabel(record.workRole)}</p>
              {record.workRole !== record.schedulingRuleRole && <p className="mt-1 text-xs text-slate-500">Rules: {formatRoleLabel(record.schedulingRuleRole)}</p>}
              <div className="mt-2"><StaffStatusBadge isActive={record.isActive} /></div>
            </div>
            <div className="min-w-0 space-y-2">
              <StaffOnboardingBadge status={record.onboarding.status} />
              <p className="text-xs text-slate-500">{getAuthStateLabel(record)}</p>
              {record.onboarding.issues.length > 0 && <details className="text-xs text-amber-800">
                <summary className="font-medium">{record.onboarding.issues.length} setup {record.onboarding.issues.length === 1 ? "item" : "items"}</summary>
                <ul className="mt-2 space-y-1 leading-5">{record.onboarding.issues.map(issue => <li key={issue}>{formatOnboardingIssue(issue)}</li>)}</ul>
              </details>}
            </div>
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-900">{formatCurrency(record.hourlyRate)}<span className="text-xs font-normal text-slate-500"> / hr</span></p>
              <p className="mt-2 text-xs font-medium text-slate-700">{formatShiftTriple(record)}</p>
              <p className="mt-1 text-xs text-slate-500">Min / target / max shifts</p>
            </div>
            <div className="min-w-0"><TrainingPhaseBadge training={record.training} /></div>
            <div className="flex justify-end">
              <button type="button" onClick={() => onEdit(record)} aria-label={`Edit ${record.fullName}`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-sky-300 hover:text-sky-800">Edit</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
