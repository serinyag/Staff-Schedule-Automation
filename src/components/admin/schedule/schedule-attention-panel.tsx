"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {useRouter} from "next/navigation";
import type { AttentionItem } from "@/lib/admin/schedule-attention";
export type ScheduleAttentionHandle = { open: () => void };
export function ScheduleAttentionPanel({reviewHandle,items,warnings,periodId,onReview,onNavigate,recheck,pending,checkMessage,publishBlocked}: {
 reviewHandle?: Ref<ScheduleAttentionHandle>;
 items: AttentionItem[];warnings:string[];periodId:string;onReview:(id:string)=>void;
 onNavigate:(destination:"budget" | "calendar")=>void;
 recheck:(data:FormData)=>void;pending:boolean;checkMessage?:string;publishBlocked:boolean;
}) {
 const router=useRouter();
 const [overrides,setOverrides]=useState<{hash:string;code:string;staff_id:string|null;week_start:string|null}[]>([]);
 const [overrideBusy,setOverrideBusy]=useState(false);
 const [overrideMessage,setOverrideMessage]=useState('');
 useEffect(()=>{let active=true;fetch('/api/admin/schedule/overrides',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list',periodId})}).then(r=>r.json()).then(data=>{if(active)setOverrides(data.review?.issues||[]);}).catch(()=>{});return()=>{active=false;};},[periodId,items]);
 async function approve(hashes:string[]){setOverrideBusy(true);try{const response=await fetch('/api/admin/schedule/overrides',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',periodId,hashes})});const data=await response.json();setOverrideMessage(data.message);if(response.ok){setOverrides(data.review.issues);router.refresh();}}catch{setOverrideMessage('Override could not be saved. Try again.');}finally{setOverrideBusy(false);}}
 const [showAll, setShowAll] = useState(false);
 const panelRef = useRef<HTMLElement>(null);
 useImperativeHandle(reviewHandle, () => ({open: () => {
   setShowAll(true);
   requestAnimationFrame(() => {
     const panel = panelRef.current;
     if (!panel) return;
     panel.focus({preventScroll:true});
     panel.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",block:"start"});
   });
 }}), []);
 const groups = [
   {label:"Coverage", items:items.filter(item => /needs \d+ staff|coverage|uncovered/i.test(item.label + " " + item.title))},
   {label:"Workload", items:items.filter(item => /minimum|target|workload|budget/i.test(item.label + " " + item.title))},
 ];
 const classified = new Set(groups.flatMap(group => group.items.map(item => item.id)));
 groups.push({label:"Assignment conflicts",items:items.filter(item => !classified.has(item.id))});
 const linkClass="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-600";
 return <section ref={panelRef} tabIndex={-1} aria-labelledby="attention-heading" id="schedule-attention" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div>
   <h2 id="attention-heading" className="text-lg font-semibold text-slate-950">{items.length?"Needs attention":"Recheck draft"} {items.length > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{items.length}</span>}</h2>
   <p className="mt-1 text-sm text-slate-600">{items.length?"Review these findings before publishing.":publishBlocked?"Recheck the schedule before publishing.":"No blocking issues reported. Review the draft before publishing."}</p>
  </div><form action={recheck}><input type="hidden" name="periodId" value={periodId}/><button disabled={pending} className={linkClass}>{pending?"Checking…":"Recheck schedule"}</button></form></div>
  {overrideMessage && <p role="status" className="mt-3 text-sm text-slate-700">{overrideMessage}</p>}
  {checkMessage && <p role="status" className="mt-3 text-sm text-slate-700">{checkMessage}</p>}
  <div className="mt-4 space-y-3">{groups.filter(group => group.items.length > 0).map(group => <details key={group.label} open={showAll || undefined} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">{group.label} <span className="ml-1 text-slate-500">{group.items.length}</span></summary><div className="mt-3 space-y-3">{group.items.map(item=>{const hashes=overrides.filter(issue=>item.overrideKey && issue.code===item.overrideKey.code && (issue.staff_id||'')===item.overrideKey.staffId && (issue.week_start||'')===item.overrideKey.weekStart).map(issue=>issue.hash);return <article key={item.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
   <h3 className="font-semibold text-slate-950">{item.title}</h3><p className="mt-1 text-sm font-semibold text-amber-900">{item.label}</p>
   <p className="mt-3 text-sm leading-6 text-slate-700">{item.explanation}</p>
   <p className="mt-2 text-sm leading-6 text-slate-700"><span className="font-semibold">Suggested next step: </span>{item.nextStep}</p>
   <div className="mt-3 flex flex-wrap gap-2">{item.shiftId && <button className={linkClass} onClick={()=>onReview(item.shiftId!)}>Review shift</button>}
    {item.relatedShifts?.map(shift => <button key={shift.id} className={linkClass} onClick={() => onReview(shift.id)}>{shift.label}</button>)}
    {item.destination === "budget" || item.destination === "calendar" ? <button type="button" className={linkClass} onClick={() => onNavigate(item.destination as "budget" | "calendar")}>{item.destination === "budget" ? "Review budget" : "View schedule"}</button> : <a className={linkClass} href={item.destination === "staff" ? "/admin/staff" : `/admin/availability?period=${encodeURIComponent(periodId)}`}>{item.destination === "staff" ? "Review staff" : "View availability"}</a>}
    {hashes.length>0 && <button type="button" disabled={overrideBusy || pending} onClick={()=>void approve(hashes)} className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950 disabled:opacity-40">{overrideBusy?'Saving…':'Override'}</button>}
   </div>
  </article>;})}</div></details>)}</div>
  {items.length > 0 && <button type="button" aria-expanded={showAll} className={`${linkClass} mt-3`} onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Expand all ${items.length} findings`}</button>}
  {!!warnings.length && <details className="mt-4 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">Preferences and other checks ({warnings.length})</summary><ul className="mt-3 space-y-2 text-sm text-slate-600">{warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}
 </section>;
}
