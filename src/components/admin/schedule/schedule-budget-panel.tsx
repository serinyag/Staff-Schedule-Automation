"use client";

import { useActionState } from "react";
import {
  updateSchedulePeriodBudgetAction,
} from "@/app/(authenticated)/admin/schedule/actions";
import { INITIAL_SCHEDULE_BUDGET_MUTATION_STATE } from "@/app/(authenticated)/admin/schedule/action-state";
import { formatCurrency } from "@/lib/admin/staff";
import type { ScheduleBudgetSummary } from "@/lib/admin/schedule";

type ScheduleBudgetPanelProps = {
  budget: ScheduleBudgetSummary;
  periodId: string;
  canEdit: boolean;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}

export function ScheduleBudgetPanel({
  budget,
  periodId,
  canEdit,
}: ScheduleBudgetPanelProps) {
  const [actionState, formAction, isPending] = useActionState(
    updateSchedulePeriodBudgetAction,
    INITIAL_SCHEDULE_BUDGET_MUTATION_STATE,
  );

  const statusTone =
    budget.monthlyBudgetEur === null
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : budget.missingMinimumRequirementInputs.length > 0
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : budget.meetsMinimumRequirement === false
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700";

  const statusMessage =
    budget.monthlyBudgetEur === null
      ? "Monthly staffing budget not configured."
      : budget.missingMinimumRequirementInputs.length > 0
        ? "Budget can't be validated until all hourly rates are filled in."
        : budget.meetsMinimumRequirement === false
          ? "Budget does not meet everyone's minimum contract hours per week."
          : "Budget covers the minimum contracted staffing cost for this period.";

  return (
    <article className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
            Budget readiness
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Monthly staffing budget
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
            Enter the euro amount you can spend on staff for this schedule period. We compare it
            against the minimum contracted staffing cost.
          </p>
        </div>

        <span
          className={[
            "inline-flex w-fit rounded-full px-4 py-2 text-sm font-semibold",
            budget.meetsMinimumRequirement === true
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700",
          ].join(" ")}
        >
          {budget.meetsMinimumRequirement === true ? "Budget ready" : "Needs review"}
        </span>
      </div>

      <div className={`mt-4 rounded-[1.4rem] border px-4 py-4 text-sm ${statusTone}`}>
        {statusMessage}
      </div>

      <div className="mt-4 grid gap-3">
        <SummaryRow
          label="Configured monthly budget"
          value={budget.monthlyBudgetEur === null ? "—" : formatCurrency(budget.monthlyBudgetEur)}
        />
        <SummaryRow
          label="Minimum required for contract minimums"
          value={budget.minimumRequiredEur === null ? "—" : formatCurrency(budget.minimumRequiredEur)}
        />
        <SummaryRow
          label="Estimated assigned spend"
          value={
            budget.estimatedAssignedSpendEur === null
              ? "—"
              : formatCurrency(budget.estimatedAssignedSpendEur)
          }
        />
        {budget.shortfallEur !== null ? (
          <SummaryRow label="Shortfall" value={formatCurrency(budget.shortfallEur)} />
        ) : null}
        {budget.remainingEur !== null ? (
          <SummaryRow label="Remaining after current assignments" value={formatCurrency(budget.remainingEur)} />
        ) : null}
      </div>

      {budget.missingMinimumRequirementInputs.length > 0 ? (
        <div className="mt-4 rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
          <p className="font-semibold">Budget validation is incomplete.</p>
          <div className="mt-2 space-y-2">
            {budget.missingMinimumRequirementInputs.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        </div>
      ) : null}

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="periodId" value={periodId} />

        {actionState.status !== "idle" && actionState.message ? (
          <div
            className={[
              "rounded-2xl px-4 py-3 text-sm font-medium",
              actionState.status === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border border-rose-200 bg-rose-50 text-rose-700",
            ].join(" ")}
          >
            {actionState.message}
          </div>
        ) : null}

        <div className="space-y-2">
          <label htmlFor="monthly-budget-eur" className="text-sm font-medium text-slate-700">
            Budget in euros for this period
          </label>
          <input
            id="monthly-budget-eur"
            name="monthlyBudgetEur"
            type="number"
            min="0"
            step="0.01"
            defaultValue={budget.monthlyBudgetEur ?? ""}
            disabled={!canEdit || isPending}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
            placeholder="12000"
          />
          <p className="text-sm text-slate-500">
            Leave blank and save if you want to clear the budget temporarily.
          </p>
          {actionState.fieldErrors?.monthlyBudgetEur ? (
            <p className="text-sm text-rose-600">{actionState.fieldErrors.monthlyBudgetEur}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            disabled={!canEdit || isPending}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isPending ? "Saving..." : "Save monthly budget"}
          </button>

          {!canEdit ? (
            <p className="text-sm text-slate-500">
              This schedule period is locked, so the budget can&apos;t be edited.
            </p>
          ) : null}
        </div>
      </form>
    </article>
  );
}
