"use client";
import { useState } from "react";
import type { AttentionItem } from "@/lib/admin/schedule-attention";
export function ScheduleAttentionPanel({items,warnings,periodId,onReview,onNavigate,recheck,pending,checkMessage,publishBlocked}: {
 items: AttentionItem[];warnings:string[];periodId:string;onReview:(id:string)=>void;
 onNavigate:(destination:"budget" | "calendar")=>void;
 recheck:(data:FormData)=>void;pending:boolean;checkMessage?:string;publishBlocked:boolean;
}) {
 const [showAll, setShowAll] = useState(false);
 const groups = [
   {label:"Coverage", items:items.filter(item => /needs \d+ staff|coverage|uncovered/i.test(item.label + " " + item.title))},
   {label:"Workload", items:items.filter(item => /minimum|target|workload|budget/i.test(item.label + " " + item.title))},
 ];
 const classified = new Set(groups.flatMap(group => group.items.map(item => item.id)));
 groups.push({label:"Assignment conflicts",items:items.filter(item => !classified.has(item.id))});
 const linkClass="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-600";
 return <section aria-labelledby="attention-heading" id="schedule-attention" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div>
   <h2 id="attention-heading" className="text-lg font-semibold text-slate-950">{items.length?"Needs attention":"Recheck draft"} {items.length > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{items.length}</span>}</h2>
   <p className="mt-1 text-sm text-slate-600">{items.length?"Review these findings before publishing.":publishBlocked?"Recheck the schedule before publishing.":"No blocking issues reported. Review the draft before publishing."}</p>
  </div><form action={recheck}><input type="hidden" name="periodId" value={periodId}/><button disabled={pending} className={linkClass}>{pending?"Checking…":"Recheck schedule"}</button></form></div>
  {checkMessage && <p role="status" className="mt-3 text-sm text-slate-700">{checkMessage}</p>}
  <div className="mt-4 space-y-3">{groups.filter(group => group.items.length > 0).map(group => <details key={group.label} open={showAll || undefined} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">{group.label} <span className="ml-1 text-slate-500">{group.items.length}</span></summary><div className="mt-3 space-y-3">{group.items.map(item=><article key={item.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
   <h3 className="font-semibold text-slate-950">{item.title}</h3><p className="mt-1 text-sm font-semibold text-amber-900">{item.label}</p>
   <p className="mt-3 text-sm leading-6 text-slate-700">{item.explanation}</p>
   <p className="mt-2 text-sm leading-6 text-slate-700"><span className="font-semibold">Suggested next step: </span>{item.nextStep}</p>
   <div className="mt-3 flex flex-wrap gap-2">{item.shiftId && <button className={linkClass} onClick={()=>onReview(item.shiftId!)}>Review shift</button>}
    {item.relatedShifts?.map(shift => <button key={shift.id} className={linkClass} onClick={() => onReview(shift.id)}>{shift.label}</button>)}
    {item.destination === "budget" || item.destination === "calendar" ? <button type="button" className={linkClass} onClick={() => onNavigate(item.destination as "budget" | "calendar")}>{item.destination === "budget" ? "Review budget" : "View schedule"}</button> : <a className={linkClass} href={item.destination === "staff" ? "/admin/staff" : `/admin/availability?period=${encodeURIComponent(periodId)}`}>{item.destination === "staff" ? "Review staff" : "View availability"}</a>}
   </div>
  </article>)}</div></details>)}</div>
  {items.length > 0 && <button type="button" aria-expanded={showAll} className={`${linkClass} mt-3`} onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Expand all ${items.length} findings`}</button>}
  {!!warnings.length && <details className="mt-4 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">Preferences and other checks ({warnings.length})</summary><ul className="mt-3 space-y-2 text-sm text-slate-600">{warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}
 </section>;
}
