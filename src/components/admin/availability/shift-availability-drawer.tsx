"use client";

import type { ShiftType, WorkRole } from "@/lib/supabase/types";
import {
  formatLongDate,
  getShiftLabel,
  getStatusBadgeLabel,
} from "@/lib/admin/availability";
import { formatRoleLabel } from "@/lib/admin/staff";

type DrawerPerson = {
  staffId: string;
  fullName: string;
  workRole: WorkRole;
  submissionStatus: "submitted" | "draft" | "not_started";
};

type ShiftAvailabilityDrawerProps = {
  dateKey: string;
  shift: ShiftType;
  available: DrawerPerson[];
  unavailable: DrawerPerson[];
  notSubmitted: DrawerPerson[];
  availableCount: number;
  statusLabel: string;
  statusTone: "risk" | "tight" | "good";
  onClose: () => void;
};

function toneClasses(tone: ShiftAvailabilityDrawerProps["statusTone"]) {
  if (tone === "risk") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (tone === "tight") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function PersonList({
  title,
  people,
  emptyMessage,
  showCheck,
}: {
  title: string;
  people: DrawerPerson[];
  emptyMessage: string;
  showCheck?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
          {title}
        </h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          {people.length}
        </span>
      </div>

      {people.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <div className="space-y-2">
          {people.map((person) => (
            <div
              key={person.staffId}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex items-start gap-3">
                <div className="pt-0.5 text-sm font-semibold text-slate-950">
                  {showCheck ? "✓" : "•"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-950">{person.fullName}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatRoleLabel(person.workRole)}</p>
                  {person.submissionStatus !== "submitted" ? (
                    <p className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-slate-600">
                      {getStatusBadgeLabel(person.submissionStatus)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ShiftAvailabilityDrawer({
  dateKey,
  shift,
  available,
  unavailable,
  notSubmitted,
  availableCount,
  statusLabel,
  statusTone,
  onClose,
}: ShiftAvailabilityDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35">
      <button
        type="button"
        aria-label="Close shift availability details"
        className="flex-1 cursor-default"
        onClick={onClose}
      />
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-white/70 bg-[#f8fbff] p-4 shadow-[-24px_0_80px_rgba(15,23,42,0.18)] sm:p-6">
        <div className="rounded-[2rem] border border-white/70 bg-white/95 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-700">
                {formatLongDate(dateKey)}
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                {getShiftLabel(shift)}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              ×
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="text-lg font-semibold text-slate-950">{availableCount} available</span>
            <span
              className={[
                "rounded-full border px-3 py-1 text-sm font-medium",
                toneClasses(statusTone),
              ].join(" ")}
            >
              {statusLabel}
            </span>
          </div>

          <div className="mt-6 space-y-6">
            <PersonList
              title="Available"
              people={available}
              emptyMessage="Nobody is available for this shift yet."
              showCheck
            />
            <PersonList
              title="Unavailable"
              people={unavailable}
              emptyMessage="No submitted staff are marked unavailable for this shift."
            />
            <PersonList
              title="No submitted availability"
              people={notSubmitted}
              emptyMessage="Everyone has submitted availability for this shift."
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
