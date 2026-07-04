"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { StaffAdminRecord, StaffFilter, StaffSummary } from "@/lib/admin/staff";
import { StaffFilters } from "@/components/admin/staff/staff-filters";
import { StaffEditDrawer } from "@/components/admin/staff/staff-edit-drawer";
import { StaffTable } from "@/components/admin/staff/staff-table";

type StaffDashboardProps = {
  records: StaffAdminRecord[];
  summary: StaffSummary;
};

const SUMMARY_CARDS: Array<{
  key: keyof StaffSummary;
  label: string;
}> = [
  { key: "totalActiveStaff", label: "Active staff" },
  { key: "managers", label: "Managers" },
  { key: "coreTeam", label: "Core Team" },
  { key: "hosts", label: "Hosts" },
  { key: "trainees", label: "Trainees" },
];

export function StaffDashboard({ records, summary }: StaffDashboardProps) {
  const [searchValue, setSearchValue] = useState("");
  const [activeFilter, setActiveFilter] = useState<StaffFilter>("all");
  const [editingRecord, setEditingRecord] = useState<StaffAdminRecord | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = deferredSearchValue.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch = normalizedSearch
        ? record.fullName.toLowerCase().includes(normalizedSearch)
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
        default:
          return true;
      }
    });
  }, [activeFilter, deferredSearchValue, records]);

  return (
    <div className="space-y-6">
      {savedMessage ? (
        <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
          {savedMessage}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {SUMMARY_CARDS.map((card) => (
          <article
            key={card.key}
            className="rounded-[1.7rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              {card.label}
            </p>
            <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
              {summary[card.key]}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
        <StaffFilters
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
        />

        <div className="mt-6">
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
    </div>
  );
}
