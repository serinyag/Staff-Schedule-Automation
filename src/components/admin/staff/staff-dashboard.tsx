"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { StaffAdminRecord, StaffFilter, StaffSummary } from "@/lib/admin/staff";
import { StaffFilters } from "@/components/admin/staff/staff-filters";
import { StaffEditDrawer } from "@/components/admin/staff/staff-edit-drawer";
import { StaffTable } from "@/components/admin/staff/staff-table";

type StaffDashboardProps = {
  records: StaffAdminRecord[];
  summary: StaffSummary;
  warningMessage?: string | null;
};

const SUMMARY_CARDS: Array<{
  key: keyof StaffSummary;
  label: string;
}> = [
  { key: "totalActiveStaff", label: "Active staff" },
  { key: "needsSetup", label: "Needs setup" },
  { key: "pendingInvitations", label: "Invitations pending" },
  { key: "trainees", label: "Trainees" },
];

export function StaffDashboard({ records, summary, warningMessage }: StaffDashboardProps) {
  const [searchValue, setSearchValue] = useState("");
  const [activeFilter, setActiveFilter] = useState<StaffFilter>("all");
  const [editingRecord, setEditingRecord] = useState<StaffAdminRecord | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = deferredSearchValue.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch = normalizedSearch
        ? record.fullName.toLowerCase().includes(normalizedSearch) ||
          (record.email ?? "").toLowerCase().includes(normalizedSearch)
        : true;

      if (!matchesSearch) {
        return false;
      }

      switch (activeFilter) {
        case "active":
          return record.isActive;
        case "inactive":
          return !record.isActive;
        case "manager":
        case "core_team":
        case "host":
          return record.workRole === activeFilter;
        case "trainees":
          return (
            record.training?.phase === "phase_1_shadow_only" ||
            record.training?.phase === "phase_2_opening_independent"
          );
        case "needs_setup":
          return record.onboarding.status === "incomplete_setup";
        case "ready_to_invite":
          return record.onboarding.status === "ready_to_invite";
        case "invitation_pending":
          return record.onboarding.status === "invitation_pending";
        case "missing_contract":
          return record.onboarding.issues.includes("missing_active_contract");
        case "missing_training":
          return record.onboarding.issues.includes("missing_training_status");
        case "login_inactive":
          return record.onboarding.status === "login_inactive";
        case "scheduling_inactive":
          return record.onboarding.status === "scheduling_inactive";
        default:
          return true;
      }
    });
  }, [activeFilter, deferredSearchValue, records]);

  return (
    <div className="space-y-6">
      {savedMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
          {savedMessage}
        </div>
      ) : null}

      {warningMessage ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          {warningMessage}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <article
            key={card.key}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm backdrop-blur"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              {card.label}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {summary[card.key]}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              Staff onboarding
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              Your team
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Manage staff details, access, and scheduling preferences.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Add staff member
          </button>
        </div>

        <StaffFilters
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
        />

        <div className="mt-5">
          <p className="mb-3 text-xs text-slate-500" aria-live="polite">{filteredRecords.length} of {records.length} staff members</p>
          <StaffTable records={filteredRecords} onEdit={setEditingRecord} />
        </div>
      </section>

      {editingRecord ? (
        <StaffEditDrawer
          key={editingRecord.id}
          record={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSaved={(message) => {
            setSavedMessage(message);
            setEditingRecord(null);
          }}
        />
      ) : null}

      {isCreateOpen ? (
        <StaffEditDrawer
          key="create-staff-member"
          record={null}
          onClose={() => setIsCreateOpen(false)}
          onSaved={(message) => {
            setSavedMessage(message);
            setIsCreateOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
