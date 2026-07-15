"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { updateStaffMemberAction } from "@/app/admin/staff/actions";
import {
  formatRoleLabel,
  INITIAL_UPDATE_STAFF_ACTION_STATE,
  TRAINING_PHASE_OPTIONS,
  WORK_ROLE_OPTIONS,
  type StaffAdminRecord,
} from "@/lib/admin/staff";

type StaffEditDrawerProps = {
  record: StaffAdminRecord;
  onClose: () => void;
  onSaved: (message: string) => void;
};

function FieldError({ message }: { message: string | undefined }) {
  if (!message) {
    return null;
  }

  return <p className="text-sm text-rose-600">{message}</p>;
}

function SectionLabel({ title, helper }: { title: string; helper?: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</h3>
      {helper ? <p className="text-sm leading-6 text-slate-500">{helper}</p> : null}
    </div>
  );
}

function SelectField({
  id,
  name,
  value,
  onChange,
  disabled,
  options,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function StaffEditDrawer({ record, onClose, onSaved }: StaffEditDrawerProps) {
  const [actionState, formAction, isPending] = useActionState(
    updateStaffMemberAction,
    INITIAL_UPDATE_STAFF_ACTION_STATE,
  );
  const [workRole, setWorkRole] = useState(record.workRole);
  const [schedulingRuleRole, setSchedulingRuleRole] = useState(record.schedulingRuleRole);
  const [hourlyRate, setHourlyRate] = useState(record.hourlyRate?.toFixed(2) ?? "");
  const [isActive, setIsActive] = useState(record.isActive);
  const [minShiftsPerWeek, setMinShiftsPerWeek] = useState(
    record.contract ? String(record.contract.minShiftsPerWeek) : "",
  );
  const [targetShiftsPerWeek, setTargetShiftsPerWeek] = useState(
    record.contract ? String(record.contract.targetShiftsPerWeek) : "",
  );
  const [maxShiftsPerWeek, setMaxShiftsPerWeek] = useState(
    record.contract?.maxShiftsPerWeek === null || !record.contract
      ? ""
      : String(record.contract.maxShiftsPerWeek),
  );
  const [trainingPhase, setTrainingPhase] = useState(record.training?.phase ?? "");
  const [deactivateConfirmed, setDeactivateConfirmed] = useState(false);

  useEffect(() => {
    if (actionState.status === "success" && actionState.message) {
      onSaved(actionState.message);
      onClose();
    }
  }, [actionState, onClose, onSaved]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isPending, onClose]);

  const isDeactivating = record.isActive && !isActive;
  const currentTrainingWarnings = record.training?.warnings ?? [];
  const trainingDescription = useMemo(
    () => TRAINING_PHASE_OPTIONS.find((option) => option.value === trainingPhase)?.description ?? "",
    [trainingPhase],
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 p-0 backdrop-blur-sm">
      <div
        aria-modal="true"
        role="dialog"
        aria-labelledby="staff-edit-title"
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-white/20 bg-white shadow-[-24px_0_80px_rgba(15,23,42,0.18)]"
      >
        <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">
                Staff editor
              </p>
              <h2 id="staff-edit-title" className="mt-2 text-2xl font-semibold text-slate-950">
                {record.fullName}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Update staffing role, scheduling rules, weekly commitments, training, and active
                status.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Close edit drawer"
            >
              ×
            </button>
          </div>
        </div>

        <form action={formAction} className="flex flex-1 flex-col">
          <input type="hidden" name="staffId" value={record.id} />
          <input type="hidden" name="staffName" value={record.fullName} />
          <input type="hidden" name="wasActive" value={String(record.isActive)} />
          <input type="hidden" name="hasTrainingRecord" value={String(Boolean(record.training))} />
          <input type="hidden" name="deactivateConfirmed" value={deactivateConfirmed ? "on" : ""} />
          <input type="hidden" name="isActive" value={String(isActive)} />
          <input
            type="hidden"
            name="currentOpeningTrainingCompletedOn"
            value={record.training?.openingTrainingCompletedOn ?? ""}
          />
          <input
            type="hidden"
            name="currentClosingTrainingCompletedOn"
            value={record.training?.closingTrainingCompletedOn ?? ""}
          />
          <input type="hidden" name="currentTrainingNote" value={record.training?.notes ?? ""} />

          <div className="flex-1 space-y-8 px-6 py-6 sm:px-8">
            {actionState.status === "error" && actionState.message ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {actionState.message}
              </div>
            ) : null}

            <section className="space-y-5">
              <SectionLabel title="Employment" />

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Full name</label>
                <input
                  value={record.fullName}
                  readOnly
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 text-slate-500"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="workRole" className="text-sm font-medium text-slate-700">
                    Work role
                  </label>
                  <SelectField
                    id="workRole"
                    name="workRole"
                    value={workRole}
                    onChange={(value) => setWorkRole(value as typeof workRole)}
                    options={WORK_ROLE_OPTIONS}
                  />
                  <FieldError message={actionState.fieldErrors?.workRole} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="schedulingRuleRole" className="text-sm font-medium text-slate-700">
                    Scheduling rule group
                  </label>
                  <SelectField
                    id="schedulingRuleRole"
                    name="schedulingRuleRole"
                    value={schedulingRuleRole}
                    onChange={(value) => setSchedulingRuleRole(value as typeof schedulingRuleRole)}
                    options={WORK_ROLE_OPTIONS}
                  />
                  <p className="text-sm leading-6 text-slate-500">
                    Work role determines the staffing budget pool. Scheduling rule group determines
                    which scheduling rules and preferences apply.
                  </p>
                  <FieldError message={actionState.fieldErrors?.schedulingRuleRole} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="hourlyRate" className="text-sm font-medium text-slate-700">
                    Hourly rate
                  </label>
                  <input
                    id="hourlyRate"
                    name="hourlyRate"
                    type="number"
                    min="0"
                    step="0.50"
                    value={hourlyRate}
                    onChange={(event) => setHourlyRate(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  />
                  <FieldError message={actionState.fieldErrors?.hourlyRate} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Active status</label>
                  <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {isActive ? "Active for future scheduling" : "Inactive"}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          Inactive staff remain in historical schedules and records.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setIsActive((current) => !current)}
                        className={[
                          "relative inline-flex h-7 w-13 items-center rounded-full transition",
                          isActive ? "bg-emerald-500" : "bg-slate-300",
                        ].join(" ")}
                        aria-pressed={isActive}
                      >
                        <span
                          className={[
                            "inline-block h-5 w-5 rounded-full bg-white shadow transition",
                            isActive ? "translate-x-7" : "translate-x-1",
                          ].join(" ")}
                        />
                      </button>
                    </div>
                  </div>
                  <FieldError message={actionState.fieldErrors?.isActive} />
                </div>
              </div>

              {isDeactivating ? (
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">
                    Deactivate this staff member?
                  </p>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    They will remain in historical schedules but should no longer be considered for
                    future scheduling.
                  </p>
                  <label className="mt-4 flex items-start gap-3 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={deactivateConfirmed}
                      onChange={(event) => setDeactivateConfirmed(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-400"
                    />
                    <span>I understand and want to deactivate this staff member.</span>
                  </label>
                </div>
              ) : null}
            </section>

            <section className="space-y-5">
              <SectionLabel title="Weekly shifts" />

              {!record.contract ? (
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                  No active employment contract was found for this staff member. Weekly shift
                  limits cannot be updated until an active contract exists.
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <label htmlFor="minShiftsPerWeek" className="text-sm font-medium text-slate-700">
                    Minimum shifts/week
                  </label>
                  <input
                    id="minShiftsPerWeek"
                    name="minShiftsPerWeek"
                    type="number"
                    min="0"
                    step="0.5"
                    value={minShiftsPerWeek}
                    onChange={(event) => setMinShiftsPerWeek(event.target.value)}
                    disabled={!record.contract}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  <FieldError message={actionState.fieldErrors?.minShiftsPerWeek} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="targetShiftsPerWeek" className="text-sm font-medium text-slate-700">
                    Target shifts/week
                  </label>
                  <input
                    id="targetShiftsPerWeek"
                    name="targetShiftsPerWeek"
                    type="number"
                    min="0"
                    step="0.5"
                    value={targetShiftsPerWeek}
                    onChange={(event) => setTargetShiftsPerWeek(event.target.value)}
                    disabled={!record.contract}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  <FieldError message={actionState.fieldErrors?.targetShiftsPerWeek} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="maxShiftsPerWeek" className="text-sm font-medium text-slate-700">
                    Maximum shifts/week
                  </label>
                  <input
                    id="maxShiftsPerWeek"
                    name="maxShiftsPerWeek"
                    type="number"
                    min="0"
                    step="0.5"
                    value={maxShiftsPerWeek}
                    onChange={(event) => setMaxShiftsPerWeek(event.target.value)}
                    disabled={!record.contract}
                    placeholder="Optional"
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  <FieldError message={actionState.fieldErrors?.maxShiftsPerWeek} />
                </div>
              </div>
            </section>

            <section className="space-y-5">
              <SectionLabel
                title="Training"
                helper={
                  record.training
                    ? "Changing the phase here updates the training record automatically."
                    : "No current training status row was found for this staff member."
                }
              />

              {currentTrainingWarnings.length > 0 ? (
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                  <p className="font-semibold">Legacy training data needs a quick review.</p>
                  <ul className="mt-2 space-y-1">
                    {currentTrainingWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-2">
                <label htmlFor="trainingPhase" className="text-sm font-medium text-slate-700">
                  Training phase
                </label>
                <SelectField
                  id="trainingPhase"
                  name="trainingPhase"
                  value={trainingPhase}
                  onChange={(value) => setTrainingPhase(value as typeof trainingPhase)}
                  disabled={!record.training}
                  options={TRAINING_PHASE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
                {record.training ? (
                  <div className="space-y-2">
                    <p className="text-sm leading-6 text-slate-500">{trainingDescription}</p>
                    <p className="text-sm leading-6 text-slate-500">
                      The selected phase now acts as the manager-approved training status.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-amber-700">
                    Add a training status row in Supabase before changing the phase here.
                  </p>
                )}
                <FieldError message={actionState.fieldErrors?.trainingPhase} />
              </div>
            </section>

            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <p className="font-medium text-slate-900">Current setup summary</p>
              <p className="mt-2">
                {record.fullName} is currently operating as {formatRoleLabel(record.workRole)} and
                following {formatRoleLabel(record.schedulingRuleRole)} scheduling rules.
              </p>
            </div>
          </div>

          <div className="sticky bottom-0 border-t border-slate-200 bg-white px-6 py-4 sm:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="inline-flex h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
