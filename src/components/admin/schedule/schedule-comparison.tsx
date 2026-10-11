"use client";
import { useActionState, useEffect, useRef } from "react";
import { queueScheduleGenerationAction } from "@/app/(authenticated)/admin/schedule/actions";
import { INITIAL_SCHEDULE_MUTATION_STATE } from "@/app/(authenticated)/admin/schedule/action-state";

type Shift = { shift_date: string; shift_type: string; previously_uncovered?: boolean; unavailable_staff?: string[] };
export type MonthlyComparison = {
  budgetOverage?: number;
  standard_gaps: number; flexible_gaps: number; monthly_formula: string; policy: string;
  staff: { name: string; before: number; after: number; allowance: number;
    weeks: { week: string; before: number; after: number; available_dates: string[]; reason: string }[];
    added: Shift[]; removed: Shift[];
  }[];
};
export function ScheduleComparison({periodId, preview, disabled, standardGaps, onViewPreview, onPreviewQueued}: {
  standardGaps: number; onViewPreview: () => void; onPreviewQueued: (id: string) => void;
  periodId: string; preview: {id: string; comparison: MonthlyComparison} | null; disabled: boolean;
}) {
  const [state, action, pending] = useActionState(queueScheduleGenerationAction, INITIAL_SCHEDULE_MUTATION_STATE);
  const notifiedRun = useRef<string | null>(null);
  useEffect(() => {
    if (state.status === "success" && state.runId && notifiedRun.current !== state.runId) {
      notifiedRun.current = state.runId;
      onPreviewQueued(state.runId);
    }
  }, [state, onPreviewQueued]);
  const button = "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50";
  const date = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", {day:"numeric",month:"short", timeZone:"UTC"});
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    <h2 className="text-lg font-semibold">Compare monthly flexibility</h2>
    <p className="mt-3 text-sm font-medium text-slate-600">Uncovered morning/evening positions</p>
    <div className="mt-2 grid grid-cols-2 gap-3">
      <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-600">Standard schedule</p><p className="mt-1 text-2xl font-semibold">{standardGaps}</p></div>
      <div className="rounded-lg bg-sky-50 p-3"><p className="text-sm text-sky-900">Flexible preview</p><p className="mt-1 text-2xl font-semibold text-sky-950">{preview ? preview.comparison.flexible_gaps : "Not generated"}</p></div>
    </div>
    {preview && <p className="mt-3 text-sm font-semibold text-sky-800">{standardGaps > preview.comparison.flexible_gaps ? `${standardGaps - preview.comparison.flexible_gaps} fewer uncovered ${standardGaps - preview.comparison.flexible_gaps === 1 ? "position" : "positions"}` : standardGaps === preview.comparison.flexible_gaps ? "Same coverage, different workload distribution" : "This preview leaves more positions uncovered"}</p>}
    <p className="mt-3 text-sm leading-6 text-slate-600">Redistribute weekly workload within each person’s monthly allowance. Availability, weekly maximums, rest, training and weekend rules still apply.</p>
    <form action={action} className="mt-4"><input type="hidden" name="periodId" value={periodId}/><input type="hidden" name="mode" value="flexible_preview"/><button className={button} disabled={disabled || pending}>{pending ? "Working…" : "Generate flexible preview"}</button></form>
    {preview && <button type="button" className={`${button} mt-3`} onClick={onViewPreview}>View flexible calendar</button>}
    {state.message && <p role="status" className="mt-3 text-sm">{state.message}</p>}
    {preview && <div className="mt-5 space-y-4">

      {!!preview.comparison.budgetOverage && preview.comparison.budgetOverage > 0 && <p className="text-sm font-semibold text-amber-800">Flexible draft exceeds budget by €{preview.comparison.budgetOverage.toFixed(2)}. Review the budget before choosing it.</p>}
      <details className="border-t border-slate-200 pt-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">View redistribution details</summary>
      <p className="my-3 text-sm text-slate-600">Monthly allowance = weekly target × days in the month ÷ 7, rounded to the nearest whole shift. Contract changes are prorated by active days.</p>
      {preview.comparison.staff.map(person => <details key={person.name} className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">{person.name}: {person.before} → {person.after} shifts · monthly allowance {person.allowance}</summary>
        <div className="mt-3 space-y-3 text-sm text-slate-600">
          {person.weeks.length === 0 && <p>Weekly totals unchanged.</p>}
          {person.weeks.map(week => <div key={week.week}><p className="font-medium">Week of {date(week.week)}: {week.before} → {week.after} shifts</p><p>{week.reason}</p><p>Available dates: {week.available_dates.length ? week.available_dates.map(date).join(", ") : "none"}.</p></div>)}
          <p><strong>Added:</strong> {person.added.length ? [...person.added].sort((a,b) => a.shift_date.localeCompare(b.shift_date)).map(s => `${date(s.shift_date)} ${s.shift_type}${s.previously_uncovered ? " (previously uncovered)" : " (reassigned)"}${s.unavailable_staff?.length ? `; unavailable: ${s.unavailable_staff.join(", ")}` : ""}`).join(", ") : "None"}.</p>
          <p><strong>Removed:</strong> {person.removed.length ? [...person.removed].sort((a,b) => a.shift_date.localeCompare(b.shift_date)).map(s => `${date(s.shift_date)} ${s.shift_type}`).join(", ") : "None"}.</p>
        </div>
      </details>)}
      </details>
    </div>}
  </section>;
}
