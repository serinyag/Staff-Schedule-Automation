"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { updateStaffMemberAction } from "@/app/admin/staff/actions";
import {
  formatOnboardingIssue,
  formatOnboardingStatus,
  INITIAL_UPDATE_STAFF_ACTION_STATE,
  TRAINING_PHASE_OPTIONS,
  WORK_ROLE_OPTIONS,
  type StaffAdminRecord,
} from "@/lib/admin/staff";
import { APP_ROLE_OPTIONS } from "@/lib/admin/staff-onboarding";
import type { AppRole, TrainingPhase, WorkRole } from "@/lib/supabase/types";

type StaffEditDrawerProps = {
  record: StaffAdminRecord | null;
  onClose: () => void;
  onSaved: (message: string) => void;
};

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

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

function Input({
  id,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
    />
  );
}

function Textarea({
  id,
  name,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      id={id}
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
    />
  );
}

function SelectField({
  id,
  name,
  value,
  onChange,
  options,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function normalizeAppRole(value: string): AppRole {
  if (value === "admin" || value === "manager" || value === "staff") {
    return value;
  }

  return "staff";
}

function normalizeWorkRole(value: string): WorkRole {
  if (value === "manager" || value === "core_team" || value === "host") {
    return value;
  }

  return "host";
}

function normalizeTrainingPhase(value: string): TrainingPhase {
  if (
    value === "phase_1_shadow_only" ||
    value === "phase_2_opening_independent" ||
    value === "phase_3_fully_trained"
  ) {
    return value;
  }

  return "phase_1_shadow_only";
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>

        <button
          type="button"
          onClick={() => onChange(!checked)}
          className={[
            "relative inline-flex h-7 w-13 items-center rounded-full transition",
            checked ? "bg-emerald-500" : "bg-slate-300",
          ].join(" ")}
          aria-pressed={checked}
        >
          <span
            className={[
              "inline-block h-5 w-5 rounded-full bg-white shadow transition",
              checked ? "translate-x-7" : "translate-x-1",
            ].join(" ")}
          />
        </button>
      </div>
    </div>
  );
}

export function StaffEditDrawer({ record, onClose, onSaved }: StaffEditDrawerProps) {
  const today = getTodayDateString();
  const isCreateMode = record === null;
  const [actionState, formAction, isPending] = useActionState(
    updateStaffMemberAction,
    INITIAL_UPDATE_STAFF_ACTION_STATE,
  );
  const [fullName, setFullName] = useState(record?.fullName ?? "");
  const [email, setEmail] = useState(record?.email ?? "");
  const [appRole, setAppRole] = useState(record?.portal?.appRole ?? record?.profile?.appRole ?? "staff");
  const [loginAccessEnabled, setLoginAccessEnabled] = useState(record?.portal?.loginAccessEnabled ?? true);
  const [sendInvitationNow, setSendInvitationNow] = useState(
    record ? record.onboarding.canSendInvitation || record.onboarding.canResendInvitation : true,
  );
  const [workRole, setWorkRole] = useState(record?.workRole ?? "host");
  const [schedulingRuleRole, setSchedulingRuleRole] = useState(record?.schedulingRuleRole ?? "host");
  const [hourlyRate, setHourlyRate] = useState(record?.hourlyRate?.toFixed(2) ?? "");
  const [isActive, setIsActive] = useState(record?.isActive ?? true);
  const [isWildcardFillIn, setIsWildcardFillIn] = useState(record?.isWildcardFillIn ?? false);
  const [minimumShiftsPerWeek, setMinimumShiftsPerWeek] = useState(
    record?.contract ? String(record.contract.minShiftsPerWeek) : "",
  );
  const [targetShiftsPerWeek, setTargetShiftsPerWeek] = useState(
    record?.contract ? String(record.contract.targetShiftsPerWeek) : "",
  );
  const [maximumShiftsPerWeek, setMaximumShiftsPerWeek] = useState(
    record?.contract?.maxShiftsPerWeek === null || !record?.contract
      ? ""
      : String(record.contract.maxShiftsPerWeek),
  );
  const [standardShiftHours, setStandardShiftHours] = useState(
    record?.contract ? String(record.contract.standardShiftHours) : "8",
  );
  const [contractStartDate, setContractStartDate] = useState(record?.contract?.startDate ?? today);
  const [contractEndDate, setContractEndDate] = useState(record?.contract?.endDate ?? "");
  const [contractNotes, setContractNotes] = useState(record?.contract?.notes ?? "");
  const [trainingPhase, setTrainingPhase] = useState(record?.training?.phase ?? "phase_1_shadow_only");
  const [trainingStartedOn, setTrainingStartedOn] = useState(record?.training?.trainingStartedOn ?? today);
  const [phaseStartedOn, setPhaseStartedOn] = useState(record?.training?.phaseStartedOn ?? "");
  const [targetCompletionOn, setTargetCompletionOn] = useState(record?.training?.targetCompletionOn ?? "");
  const [openingTrainingCompletedOn, setOpeningTrainingCompletedOn] = useState(
    record?.training?.openingTrainingCompletedOn ?? "",
  );
  const [closingTrainingCompletedOn, setClosingTrainingCompletedOn] = useState(
    record?.training?.closingTrainingCompletedOn ?? "",
  );
  const [trainingNotes, setTrainingNotes] = useState(record?.training?.notes ?? "");
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

  const trainingDescription = useMemo(
    () => TRAINING_PHASE_OPTIONS.find((option) => option.value === trainingPhase)?.description ?? "",
    [trainingPhase],
  );
  const inviteLabel = record?.onboarding.canResendInvitation
    ? "Resend invitation now"
    : "Send login invitation now";
  const showingDeactivationConfirmation = Boolean(record?.isActive && !isActive);

  function handleLoginAccessEnabledChange(nextValue: boolean) {
    setLoginAccessEnabled(nextValue);

    if (!nextValue) {
      setSendInvitationNow(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 p-0 backdrop-blur-sm">
      <div
        aria-modal="true"
        role="dialog"
        aria-labelledby="staff-edit-title"
        className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-white/20 bg-white shadow-[-24px_0_80px_rgba(15,23,42,0.18)]"
      >
        <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">
                {isCreateMode ? "Add staff member" : "Staff editor"}
              </p>
              <h2 id="staff-edit-title" className="mt-2 text-2xl font-semibold text-slate-950">
                {isCreateMode ? "Create staff onboarding" : record.fullName}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {isCreateMode
                  ? "Set up the operational staff record, portal access, contract, training, and scheduling state in one safe flow."
                  : "Update portal access, scheduling setup, contracts, and training without losing historical assignments."}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Close staff drawer"
            >
              ×
            </button>
          </div>
        </div>

        <form action={formAction} className="flex flex-1 flex-col">
          <input type="hidden" name="staffId" value={record?.id ?? ""} />
          <input type="hidden" name="wasActive" value={String(record?.isActive ?? false)} />
          <input type="hidden" name="deactivateConfirmed" value={deactivateConfirmed ? "on" : ""} />

          <div className="flex-1 space-y-8 px-6 py-6 sm:px-8">
            {actionState.status === "error" && actionState.message ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {actionState.message}
              </div>
            ) : null}

            {record ? (
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-900">
                    {formatOnboardingStatus(record.onboarding.status)}
                  </span>
                  {record.portal ? (
                    <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                      {record.portal.loginAccessEnabled ? "Login enabled" : "Login disabled"}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    {record.isActive ? "Scheduling active" : "Scheduling inactive"}
                  </span>
                </div>

                {record.onboarding.issues.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-sm leading-6 text-amber-800">
                    {record.onboarding.issues.map((issue) => (
                      <li key={issue}>{formatOnboardingIssue(issue)}</li>
                    ))}
                  </ul>
                ) : null}

                {record.authUser && !record.portal?.authUserId ? (
                  <p className="mt-3 text-sm leading-6 text-sky-700">
                    An existing Supabase Auth account already matches this email. Saving will link
                    it to the staff record and activate the application profile if login access is enabled.
                  </p>
                ) : null}

                {record.portal?.invitationLastError ? (
                  <p className="mt-3 text-sm leading-6 text-rose-700">
                    Last invitation issue: {record.portal.invitationLastError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <section className="space-y-5">
              <SectionLabel
                title="Identity and access"
                helper="Authentication account, application access, and scheduling activation are managed separately."
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="fullName" className="text-sm font-medium text-slate-700">
                    Full name
                  </label>
                  <Input id="fullName" name="fullName" value={fullName} onChange={setFullName} />
                  <FieldError message={actionState.fieldErrors?.fullName} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-slate-700">
                    Email address
                  </label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="staff@yourstudio.com"
                  />
                  <FieldError message={actionState.fieldErrors?.email} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="appRole" className="text-sm font-medium text-slate-700">
                    Application access role
                  </label>
                  <SelectField
                    id="appRole"
                    name="appRole"
                    value={appRole}
                    onChange={(value) => setAppRole(normalizeAppRole(value))}
                    options={APP_ROLE_OPTIONS}
                  />
                  <FieldError message={actionState.fieldErrors?.appRole} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Login invitation</label>
                  <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="sendInvitationNow"
                      checked={sendInvitationNow}
                      disabled={!loginAccessEnabled}
                      onChange={(event) => setSendInvitationNow(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-sky-400"
                    />
                    <span>{inviteLabel}</span>
                  </label>
                  <FieldError message={actionState.fieldErrors?.sendInvitationNow} />
                </div>
              </div>

              <ToggleRow
                title="Can log in to the application"
                description="This controls whether the linked application profile should be active for sign-in once the Auth account is connected."
                checked={loginAccessEnabled}
                onChange={handleLoginAccessEnabledChange}
              />
              <input type="hidden" name="loginAccessEnabled" value={loginAccessEnabled ? "on" : ""} />
              <FieldError message={actionState.fieldErrors?.loginAccessEnabled} />

              <ToggleRow
                title="Active employee for scheduling"
                description="Scheduling activation controls planning-context eligibility and availability submission access independently from login access."
                checked={isActive}
                onChange={setIsActive}
              />
              <input type="hidden" name="isActive" value={isActive ? "on" : ""} />
              <FieldError message={actionState.fieldErrors?.isActive} />

              {showingDeactivationConfirmation ? (
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">
                    Deactivate this employee for future scheduling?
                  </p>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    Historical assignments and availability stay intact, but future planning will
                    exclude this employee once you save.
                  </p>
                  <label className="mt-4 flex items-start gap-3 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={deactivateConfirmed}
                      onChange={(event) => setDeactivateConfirmed(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-400"
                    />
                    <span>I understand and want to deactivate this staff member for scheduling.</span>
                  </label>
                </div>
              ) : null}
            </section>

            <section className="space-y-5">
              <SectionLabel
                title="Employment and scheduling"
                helper="Work role, scheduling-rule role, contract terms, and wildcard status stay separate."
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="workRole" className="text-sm font-medium text-slate-700">
                    Work role
                  </label>
                  <SelectField
                    id="workRole"
                    name="workRole"
                    value={workRole}
                    onChange={(value) => setWorkRole(normalizeWorkRole(value))}
                    options={WORK_ROLE_OPTIONS}
                  />
                  <FieldError message={actionState.fieldErrors?.workRole} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="schedulingRuleRole" className="text-sm font-medium text-slate-700">
                    Scheduling rule role
                  </label>
                  <SelectField
                    id="schedulingRuleRole"
                    name="schedulingRuleRole"
                    value={schedulingRuleRole}
                    onChange={(value) => setSchedulingRuleRole(normalizeWorkRole(value))}
                    options={WORK_ROLE_OPTIONS}
                  />
                  <p className="text-sm leading-6 text-slate-500">
                    Work role determines the staffing budget pool. Scheduling rule role controls
                    rule behavior in the generator and validator.
                  </p>
                  <FieldError message={actionState.fieldErrors?.schedulingRuleRole} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="hourlyRate" className="text-sm font-medium text-slate-700">
                    Hourly rate
                  </label>
                  <Input
                    id="hourlyRate"
                    name="hourlyRate"
                    type="number"
                    value={hourlyRate}
                    onChange={setHourlyRate}
                    placeholder="15.00"
                  />
                  <FieldError message={actionState.fieldErrors?.hourlyRate} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="standardShiftHours" className="text-sm font-medium text-slate-700">
                    Standard shift hours
                  </label>
                  <Input
                    id="standardShiftHours"
                    name="standardShiftHours"
                    type="number"
                    value={standardShiftHours}
                    onChange={setStandardShiftHours}
                  />
                  <FieldError message={actionState.fieldErrors?.standardShiftHours} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <label htmlFor="minShiftsPerWeek" className="text-sm font-medium text-slate-700">
                    Minimum shifts/week
                  </label>
                  <Input
                    id="minShiftsPerWeek"
                    name="minShiftsPerWeek"
                    type="number"
                    value={minimumShiftsPerWeek}
                    onChange={setMinimumShiftsPerWeek}
                  />
                  <FieldError message={actionState.fieldErrors?.minShiftsPerWeek} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="targetShiftsPerWeek" className="text-sm font-medium text-slate-700">
                    Target shifts/week
                  </label>
                  <Input
                    id="targetShiftsPerWeek"
                    name="targetShiftsPerWeek"
                    type="number"
                    value={targetShiftsPerWeek}
                    onChange={setTargetShiftsPerWeek}
                  />
                  <FieldError message={actionState.fieldErrors?.targetShiftsPerWeek} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="maxShiftsPerWeek" className="text-sm font-medium text-slate-700">
                    Maximum shifts/week
                  </label>
                  <Input
                    id="maxShiftsPerWeek"
                    name="maxShiftsPerWeek"
                    type="number"
                    value={maximumShiftsPerWeek}
                    onChange={setMaximumShiftsPerWeek}
                    placeholder="Optional"
                  />
                  <FieldError message={actionState.fieldErrors?.maxShiftsPerWeek} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="contractStartDate" className="text-sm font-medium text-slate-700">
                    Contract start date
                  </label>
                  <Input
                    id="contractStartDate"
                    name="contractStartDate"
                    type="date"
                    value={contractStartDate}
                    onChange={setContractStartDate}
                  />
                  <FieldError message={actionState.fieldErrors?.contractStartDate} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="contractEndDate" className="text-sm font-medium text-slate-700">
                    Contract end date
                  </label>
                  <Input
                    id="contractEndDate"
                    name="contractEndDate"
                    type="date"
                    value={contractEndDate}
                    onChange={setContractEndDate}
                    placeholder="Optional"
                  />
                  <FieldError message={actionState.fieldErrors?.contractEndDate} />
                </div>
              </div>

              <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="isWildcardFillIn"
                  checked={isWildcardFillIn}
                  onChange={(event) => setIsWildcardFillIn(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-sky-400"
                />
                <span>Enable wildcard fill-in availability for this employee</span>
              </label>
              <FieldError message={actionState.fieldErrors?.isWildcardFillIn} />

              <div className="space-y-2">
                <label htmlFor="contractNotes" className="text-sm font-medium text-slate-700">
                  Employment notes
                </label>
                <Textarea
                  id="contractNotes"
                  name="contractNotes"
                  value={contractNotes}
                  onChange={setContractNotes}
                  placeholder="Optional contract or scheduling notes"
                />
              </div>
            </section>

            <section className="space-y-5">
              <SectionLabel
                title="Training"
                helper="Phase 1 is shadow-only with any fully trained Phase 3 teammate on the same shift. Phase 2 requires completed opening training. Phase 3 requires completed opening and closing training."
              />

              <div className="space-y-2">
                <label htmlFor="trainingPhase" className="text-sm font-medium text-slate-700">
                  Training phase
                </label>
                <SelectField
                  id="trainingPhase"
                  name="trainingPhase"
                  value={trainingPhase}
                  onChange={(value) => setTrainingPhase(normalizeTrainingPhase(value))}
                  options={TRAINING_PHASE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
                <p className="text-sm leading-6 text-slate-500">{trainingDescription}</p>
                <FieldError message={actionState.fieldErrors?.trainingPhase} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="trainingStartedOn" className="text-sm font-medium text-slate-700">
                    Training started date
                  </label>
                  <Input
                    id="trainingStartedOn"
                    name="trainingStartedOn"
                    type="date"
                    value={trainingStartedOn}
                    onChange={setTrainingStartedOn}
                  />
                  <FieldError message={actionState.fieldErrors?.trainingStartedOn} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="phaseStartedOn" className="text-sm font-medium text-slate-700">
                    Phase started date
                  </label>
                  <Input
                    id="phaseStartedOn"
                    name="phaseStartedOn"
                    type="date"
                    value={phaseStartedOn}
                    onChange={setPhaseStartedOn}
                  />
                  <FieldError message={actionState.fieldErrors?.phaseStartedOn} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="targetCompletionOn" className="text-sm font-medium text-slate-700">
                    Target completion date
                  </label>
                  <Input
                    id="targetCompletionOn"
                    name="targetCompletionOn"
                    type="date"
                    value={targetCompletionOn}
                    onChange={setTargetCompletionOn}
                  />
                  <FieldError message={actionState.fieldErrors?.targetCompletionOn} />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="openingTrainingCompletedOn"
                    className="text-sm font-medium text-slate-700"
                  >
                    Opening training completed date
                  </label>
                  <Input
                    id="openingTrainingCompletedOn"
                    name="openingTrainingCompletedOn"
                    type="date"
                    value={openingTrainingCompletedOn}
                    onChange={setOpeningTrainingCompletedOn}
                  />
                  <FieldError message={actionState.fieldErrors?.openingTrainingCompletedOn} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="closingTrainingCompletedOn"
                    className="text-sm font-medium text-slate-700"
                  >
                    Closing training completed date
                  </label>
                  <Input
                    id="closingTrainingCompletedOn"
                    name="closingTrainingCompletedOn"
                    type="date"
                    value={closingTrainingCompletedOn}
                    onChange={setClosingTrainingCompletedOn}
                  />
                  <p className="text-sm leading-6 text-slate-500">
                    In the current schema this also acts as the fully trained date.
                  </p>
                  <FieldError message={actionState.fieldErrors?.closingTrainingCompletedOn} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="trainingNotes" className="text-sm font-medium text-slate-700">
                    Training notes
                  </label>
                  <Textarea
                    id="trainingNotes"
                    name="trainingNotes"
                    value={trainingNotes}
                    onChange={setTrainingNotes}
                    placeholder="Optional training notes"
                  />
                </div>
              </div>

              {record?.training?.warnings.length ? (
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">Current training warnings</p>
                  <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-800">
                    {record.training.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>

          <div className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur sm:px-8">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
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
                {isPending
                  ? isCreateMode
                    ? "Creating staff member..."
                    : "Saving changes..."
                  : isCreateMode
                    ? "Create staff member"
                    : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
