"use client";
import type { AttentionItem } from "@/lib/admin/schedule-attention";
export function ScheduleAttentionPanel({items,warnings,periodId,onReview,recheck,pending,checkMessage,publishBlocked}: {
 items: AttentionItem[];warnings:string[];periodId:string;onReview:(id:string)=>void;
 recheck:(data:FormData)=>void;pending:boolean;checkMessage?:string;publishBlocked:boolean;
}) {
 const linkClass="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-600";
 return <section aria-labelledby="attention-heading" id="schedule-attention" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div>
   <h2 id="attention-heading" className="text-lg font-semibold text-slate-950">{items.length?`${items.length} ${items.length===1?"item needs":"items need"} attention`:"Draft checks"}</h2>
   <p className="mt-1 text-sm text-slate-600">{items.length?"Review these findings before publishing.":publishBlocked?"Recheck the schedule before publishing.":"No blocking issues reported. Review the draft before publishing."}</p>
  </div><form action={recheck}><input type="hidden" name="periodId" value={periodId}/><button disabled={pending} className={linkClass}>{pending?"Checking…":"Recheck schedule"}</button></form></div>
  {checkMessage && <p role="status" className="mt-3 text-sm text-slate-700">{checkMessage}</p>}
  <div className="mt-4 space-y-3">{items.map(item=><article key={item.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
   <h3 className="font-semibold text-slate-950">{item.title}</h3><p className="mt-1 text-sm font-semibold text-amber-900">{item.label}</p>
   <p className="mt-3 text-sm leading-6 text-slate-700">{item.explanation}</p>
   <p className="mt-2 text-sm leading-6 text-slate-700"><span className="font-semibold">Suggested next step: </span>{item.nextStep}</p>
   <div className="mt-3 flex flex-wrap gap-2">{item.shiftId && <button className={linkClass} onClick={()=>onReview(item.shiftId!)}>Review shift</button>}
    <a className={linkClass} href={item.destination==="budget"?"#schedule-budget":item.destination==="staff"?"/admin/staff":item.destination==="availability"?`/admin/availability?period=${encodeURIComponent(periodId)}`:"#schedule-calendar"}>{item.destination==="budget"?"Review budget":item.destination==="staff"?"Review staff":item.destination==="availability"?"View availability":"View schedule"}</a>
   </div>
  </article>)}</div>
  {!!warnings.length && <details className="mt-4 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">Preferences and other checks ({warnings.length})</summary><ul className="mt-3 space-y-2 text-sm text-slate-600">{warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}
 </section>;
}
