"use client";

import type { StaffFilter } from "@/lib/admin/staff";

const FILTER_OPTIONS: Array<{ value: StaffFilter; label: string }> = [
  { value: "all", label: "All staff" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "manager", label: "Manager" },
  { value: "core_team", label: "Core Team" },
  { value: "host", label: "Host" },
  { value: "trainees", label: "Trainees" },
];

type StaffFiltersProps = {
  activeFilter: StaffFilter;
  onFilterChange: (value: StaffFilter) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
};

export function StaffFilters({
  activeFilter,
  onFilterChange,
  searchValue,
  onSearchChange,
}: StaffFiltersProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_1fr] lg:items-center">
        <div className="space-y-2">
          <label htmlFor="staff-search" className="text-sm font-medium text-slate-700">
            Search staff
          </label>
          <input
            id="staff-search"
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search by staff name"
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          />
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-700">Filter</span>
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((option) => {
              const isActive = option.value === activeFilter;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onFilterChange(option.value)}
                  className={[
                    "inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition",
                    isActive
                      ? "bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)]"
                      : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
