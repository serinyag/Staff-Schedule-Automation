"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  formatScheduleLongDate,
  formatScheduleStatusLabel,
  formatShiftTimeRange,
  type ScheduleShiftView,
} from "@/lib/admin/schedule";
import { formatRoleLabel } from "@/lib/admin/staff";
import type { WorkRole } from "@/lib/supabase/types";

export type CandidateRecord = {
  staffId: string;
  staffName: string;
  workRole: WorkRole;
  reasons: string[];
};

export type ScheduleDrawerData = {
  shift: {
    id: string;
    dateKey: string;
    shiftType: string;
    startTime: string | null;
    endTime: string | null;
    requiredCount: number;
  };
  currentAssignments: Array<{
    id: string;
    staffId: string;
    staffName: string;
    lifecycle: "draft" | "published";
  }>;
  eligible: CandidateRecord[];
  blocked: CandidateRecord[];
  unavailable: CandidateRecord[];
};

type ScheduleEditDrawerProps = {
  open: boolean;
  onClose: () => void;
  periodId: string;
  shift: ScheduleShiftView | null;
  drawerData: ScheduleDrawerData | null;
  isLoading: boolean;
  loadError: string | null;
  onRefresh: () => Promise<void>;
};

function GroupSection({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "eligible" | "blocked" | "unavailable";
  children: ReactNode;
}) {
  const toneClasses =
    tone === "eligible"
      ? "border-emerald-200 bg-emerald-50/80"
      : tone === "blocked"
        ? "border-amber-200 bg-amber-50/80"
        : "border-rose-200 bg-rose-50/80";

  return (
    <section className={`rounded-[1.4rem] border px-4 py-4 ${toneClasses}`}>
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function ScheduleEditDrawer({
  open,
  onClose,
  periodId,
  shift,
  drawerData,
  isLoading,
  loadError,
  onRefresh,
}: ScheduleEditDrawerProps) {
  const [addState, setAddState] = useState<{ status: "idle" | "success" | "error"; message: string }>({
    status: "idle",
    message: "",
  });
  const [removeState, setRemoveState] = useState<{ status: "idle" | "success" | "error"; message: string }>({
    status: "idle",
    message: "",
  });
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const shiftTimeLabel = shift ? formatShiftTimeRange(shift) : null;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  async function submitAssignment(payload: Record<string, string>, mode: "assign" | "remove") {
    if (!shift) {
      return;
    }

    if (mode === "assign") {
      setIsAdding(true);
      setAddState({ status: "idle", message: "" });
    } else {
      setIsRemoving(true);
      setRemoveState({ status: "idle", message: "" });
    }

    try {
      const response = await fetch("/api/admin/schedule/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responsePayload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;

      if (!response.ok) {
        throw new Error(responsePayload?.message ?? `Assignment returned ${response.status}`);
      }

      const successMessage =
        responsePayload?.message ??
        (mode === "assign" ? "Draft assignment saved." : "Draft assignment removed.");

      if (mode === "assign") {
        setAddState({ status: "success", message: successMessage });
      } else {
        setRemoveState({ status: "success", message: successMessage });
      }

      await onRefresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : mode === "assign"
            ? "The assignment could not be saved. Please try again."
            : "The assignment could not be removed. Please try again.";

      if (mode === "assign") {
        setAddState({ status: "error", message });
      } else {
        setRemoveState({ status: "error", message });
      }
    } finally {
      if (mode === "assign") {
        setIsAdding(false);
      } else {
        setIsRemoving(false);
      }
    }
  }

  if (!open || !shift) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/55"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-edit-drawer-title"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-white px-6 py-6 shadow-[0_28px_80px_rgba(15,23,42,0.35)] sm:px-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-700">
              Draft assignment editor
            </p>
            <h2
              id="schedule-edit-drawer-title"
              className="text-2xl font-semibold tracking-tight text-slate-950"
            >
              {formatScheduleLongDate(shift.dateKey)}
            </h2>
            <p className="text-sm text-slate-600">
              {shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1)}
              {shiftTimeLabel && shiftTimeLabel !== "Time TBD" ? ` · ${shiftTimeLabel}` : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
          >
            Close
          </button>
        </div>

        <div className="mt-4 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          <p>
            Required coverage:{" "}
            <span className="font-semibold text-slate-950">{shift.requiredCount}</span>
          </p>
          <p className="mt-1">
            Current view:{" "}
            <span className="font-semibold text-slate-950">
              {formatScheduleStatusLabel(shift.assignments[0]?.lifecycle ?? "draft")}
            </span>
          </p>
        </div>

        {loadError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {loadError}
          </div>
        ) : null}
        {addState.status === "error" ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {addState.message}
          </div>
        ) : null}
        {removeState.status === "error" ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {removeState.message}
          </div>
        ) : null}
        {addState.status === "success" ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {addState.message}
          </div>
        ) : null}
        {removeState.status === "success" ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {removeState.message}
          </div>
        ) : null}

        {isLoading || !drawerData ? (
          <div className="mt-6 space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-[1.4rem] bg-slate-200/80" />
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <GroupSection title="Current assignments" tone="eligible">
              {drawerData.currentAssignments.length === 0 ? (
                <p className="text-sm text-slate-500">No one is assigned to this shift yet.</p>
              ) : (
                drawerData.currentAssignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{assignment.staffName}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                        {formatScheduleStatusLabel(assignment.lifecycle)}
                      </p>
                    </div>

                    {assignment.lifecycle === "draft" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void submitAssignment(
                            {
                              action: "remove",
                              periodId,
                              assignmentId: assignment.id,
                            },
                            "remove",
                          )
                        }
                        disabled={isRemoving}
                        className="rounded-full border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isRemoving ? "Removing..." : "Remove"}
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-slate-500">Published</span>
                    )}
                  </div>
                ))
              )}
            </GroupSection>

            <GroupSection title="Eligible" tone="eligible">
              {drawerData.eligible.length === 0 ? (
                <p className="text-sm text-slate-500">No eligible staff available right now.</p>
              ) : (
                drawerData.eligible.map((candidate) => (
                  <div
                    key={candidate.staffId}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{candidate.staffName}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatRoleLabel(candidate.workRole)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void submitAssignment(
                          {
                            action: "assign",
                            periodId,
                            shiftId: shift.id,
                            staffId: candidate.staffId,
                          },
                          "assign",
                        )
                      }
                      disabled={isAdding}
                      className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {isAdding ? "Saving..." : "Assign"}
                    </button>
                  </div>
                ))
              )}
            </GroupSection>

            <GroupSection title="Unavailable" tone="unavailable">
              {drawerData.unavailable.length === 0 ? (
                <p className="text-sm text-slate-500">No one is marked unavailable for this shift.</p>
              ) : (
                drawerData.unavailable.map((candidate) => (
                  <div key={candidate.staffId} className="rounded-2xl border border-rose-200 bg-white px-4 py-3">
                    <p className="text-sm font-semibold text-slate-950">{candidate.staffName}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatRoleLabel(candidate.workRole)}</p>
                    <ul className="mt-2 space-y-1 text-sm text-rose-700">
                      {candidate.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </GroupSection>
          </div>
        )}
      </div>
    </div>
  );
}
