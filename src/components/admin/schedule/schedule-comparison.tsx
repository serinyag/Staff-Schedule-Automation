"use client";
import { useActionState } from "react";
import { queueScheduleGenerationAction } from "@/app/(authenticated)/admin/schedule/actions";
import { INITIAL_SCHEDULE_MUTATION_STATE } from "@/app/(authenticated)/admin/schedule/action-state";

type Shift = { shift_date: string; shift_type: string; previously_uncovered?: boolean; unavailable_staff?: string[] };
export type MonthlyComparison = {
  standard_gaps: number; flexible_gaps: number; monthly_formula: string; policy: string;
  staff: { name: string; before: number; after: number; allowance: number;
    weeks: { week: string; before: number; after: number; available_dates: string[]; reason: string }[];
    added: Shift[]; removed: Shift[];
  }[];
};
export function ScheduleComparison({periodId, preview, disabled, currentMode, adoptedPreviewId}: {
  currentMode: "standard" | "flexible"; adoptedPreviewId: string | null;
  periodId: string; preview: {id: string; comparison: MonthlyComparison} | null; disabled: boolean;
}) {
  const [state, action, pending] = useActionState(queueScheduleGenerationAction, INITIAL_SCHEDULE_MUTATION_STATE);
  const button = "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50";
  const date = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", {day:"numeric",month:"short", timeZone:"UTC"});
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    <p className="mb-2 text-sm font-semibold text-sky-800">Current draft: {currentMode === "flexible" ? "Flexible monthly redistribution" : "Standard weekly rules"}</p>
    <h2 className="text-lg font-semibold">Compare monthly flexibility</h2>
    <p className="mt-2 text-sm text-slate-600">Keep the standard draft and preview an alternative that redistributes weekly workload within each person’s monthly allowance. Weekly maximums, availability, rest, training and weekend rules still apply.</p>
    <p className="mt-2 text-sm text-slate-600">Monthly allowance = weekly target × days in the month ÷ 7, rounded to the nearest whole shift. Contract changes are prorated by active days. For example, 2 shifts per week in 31 days gives 9 shifts.</p>
    <form action={action} className="mt-4"><input type="hidden" name="periodId" value={periodId}/><input type="hidden" name="mode" value="flexible_preview"/><button className={button} disabled={disabled || pending}>{pending ? "Working…" : "Generate flexible preview"}</button></form>
    {state.message && <p role="status" className="mt-3 text-sm">{state.message}</p>}
    {preview && <div className="mt-5 space-y-4">
      <p className="font-medium">Uncovered morning/evening positions: standard {preview.comparison.standard_gaps} · flexible {preview.comparison.flexible_gaps}</p>
      <p className="text-sm text-slate-600">This is a proposal, not a published schedule. Totals may change from the standard draft, but cannot exceed the monthly allowance. Remaining gaps may still need review.</p>
      {preview.comparison.staff.map(person => <details key={person.name} className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">{person.name}: {person.before} → {person.after} shifts · monthly allowance {person.allowance}</summary>
        <div className="mt-3 space-y-3 text-sm text-slate-600">
          {person.weeks.length === 0 && <p>Weekly totals unchanged.</p>}
          {person.weeks.map(week => <div key={week.week}><p className="font-medium">Week of {date(week.week)}: {week.before} → {week.after} shifts</p><p>{week.reason}</p><p>Available dates: {week.available_dates.length ? week.available_dates.map(date).join(", ") : "none"}.</p></div>)}
          <p><strong>Added:</strong> {person.added.length ? person.added.map(s => `${date(s.shift_date)} ${s.shift_type}${s.previously_uncovered ? " (previously uncovered)" : " (reassigned)"}${s.unavailable_staff?.length ? `; unavailable: ${s.unavailable_staff.join(", ")}` : ""}`).join(", ") : "None"}.</p>
          <p><strong>Removed:</strong> {person.removed.length ? person.removed.map(s => `${date(s.shift_date)} ${s.shift_type}`).join(", ") : "None"}.</p>
        </div>
      </details>)}
      <form action={action}><input type="hidden" name="periodId" value={periodId}/><input type="hidden" name="mode" value="adopt_flexible"/><input type="hidden" name="previewRunId" value={preview.id}/><button className={button} disabled={disabled || pending || adoptedPreviewId === preview.id}>{adoptedPreviewId === preview.id ? "Flexible version selected" : "Approve redistribution and use flexible draft"}</button></form>
      <p className="text-xs text-slate-500">Choosing this version replaces draft assignments only. The standard version remains in generation history. Changed inputs require a new preview.</p>
    </div>}
  </section>;
}
