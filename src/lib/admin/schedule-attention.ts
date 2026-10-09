export type AttentionItem = {
  id: string; title: string; label: string; explanation: string; nextStep: string;
  relatedShifts?: { id: string; label: string }[];
  shiftId: string | null; destination: "availability" | "staff" | "budget" | "calendar";
};
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(obj) : [];
const str = (v: unknown) => typeof v === "string" ? v : "";
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const clean = (v: unknown) => str(v).replace(/[\u2013\u2014]/g, ", ");
export function reviewDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  if (!Number.isFinite(new Date(value+"T12:00:00Z").getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(value+"T12:00:00Z"));
}
export function buildScheduleAttention(input: {
  issues: unknown; metadata: unknown; shifts: unknown; staff: unknown; assignments: unknown;
  context?: unknown; availabilityRevision?: number; budget: number | null; cost: number | null;
}): {items: AttentionItem[]; warnings: string[]} {
  const shifts=rows(input.shifts), staff=rows(input.staff), assignments=rows(input.assignments);
  const metadata=obj(input.metadata), validation=obj(metadata.validation), context=obj(input.context);
  const snapshot=rows(metadata.draft_assignments);
  const signature=(a: Row[]) => a.map(x=>`${x.shift_id}:${x.staff_id}`).sort().join("|");
  const currentSnapshot=snapshot.length>0 && signature(snapshot)===signature(assignments) &&
    typeof input.availabilityRevision === "number" && metadata.availability_revision===input.availabilityRevision;
  const generated=currentSnapshot?[...rows(validation.errors), ...rows(validation.review_items)]:[];
  const issues=[...generated,...rows(input.issues).filter(x=>x.severity==="block" || x.severity==="error")];
  const items: AttentionItem[]=[];const seen=new Set<string>();
  for (const [index, issue] of issues.entries()) {
    const details=obj(issue.details), message=clean(issue.message), code=str(issue.code);
    if (/budget/i.test(code+message)) continue; // Actual current overage is added below.
    const day=str(issue.dateKey || issue.shift_date || issue.week_start) || message.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
    const kind=str(issue.shiftType || issue.shift_type) || message.match(/\b(morning|day|evening) shift/i)?.[1]?.toLowerCase() || "";
    const shift=shifts.find(s=>s.id===issue.shift_id || (s.shift_date===day && s.shift_type===kind));
    const shiftId=shift?str(shift.id):null;
    const member=staff.find(s=>s.id===issue.staff_id);
    const name=str(issue.staffName || issue.staff_name || member?.full_name);
    const date=str(shift?.shift_date)||day, type=str(shift?.shift_type)||kind;
    const coverage=/uncovered|short by|coverage.*below/i.test(code+" "+message);
    // Day shifts are optional workload support, not service coverage gaps.
    if (coverage && type === "day") continue;
    if (/weekend|both Saturday and Sunday/i.test(code + " " + message)) {
      const matchingStaff = staff.filter(person => {
        if (issue.staff_id) return person.id === issue.staff_id;
        if (name) return person.full_name === name;
        const rule = rows(context.role_rules).find(rule => rule.is_active !== false &&
          (rule.scheduling_rule_role || rule.work_role) === (person.scheduling_rule_role || person.work_role));
        return { ...obj(rule?.raw), ...obj(rule?.rule_config) }.block_full_weekend === true;
      });
      let resolved = false;
      for (const person of matchingStaff) {
        const worked = shifts.filter(s => assignments.some(a => a.staff_id === person.id && a.shift_id === s.id));
        for (const saturday of worked.filter(s => new Date(str(s.shift_date) + "T12:00:00Z").getUTCDay() === 6)) {
          const sundayDate = new Date(str(saturday.shift_date) + "T12:00:00Z");
          sundayDate.setUTCDate(sundayDate.getUTCDate() + 1);
          const sunday = worked.find(s => s.shift_date === sundayDate.toISOString().slice(0, 10));
          if (!sunday) continue;
          if (issue.week_start) {
            const monday = new Date(str(saturday.shift_date) + "T12:00:00Z");
            monday.setUTCDate(monday.getUTCDate() - 5);
            if (monday.toISOString().slice(0, 10) !== issue.week_start) continue;
          }
          resolved = true;
          const weekendKey = `weekend:${person.id}:${saturday.shift_date}`;
          if (seen.has(weekendKey)) continue;
          seen.add(weekendKey);
          const personName = str(person.full_name);
          const satLabel = `${reviewDate(str(saturday.shift_date))} ${str(saturday.shift_type)}`;
          const sunLabel = `${reviewDate(str(sunday.shift_date))} ${str(sunday.shift_type)}`;
          items.push({ id: weekendKey, title: `${personName} · ${reviewDate(str(saturday.shift_date))} / ${reviewDate(str(sunday.shift_date))}`,
            label: "Both weekend days assigned",
            explanation: `${personName} works ${satLabel} and ${sunLabel}. Their scheduling rule allows only one day of this weekend.`,
            nextStep: `Reassign either ${personName}’s Saturday shift or Sunday shift to another available staff member who meets the shift rules, so ${personName} works only one of those days.`,
            shiftId: null, destination: "availability", relatedShifts: [
              { id: str(saturday.id), label: `Review ${satLabel}` }, { id: str(sunday.id), label: `Review ${sunLabel}` },
            ],
          });
        }
      }
      if (resolved) continue;
    }
    const key=coverage && shiftId?`coverage:${shiftId}`:`${code}:${name}:${date}:${message}:${index}`;
    if (seen.has(key)) continue; seen.add(key);
    let title=[reviewDate(date),type?type[0].toUpperCase()+type.slice(1):name].filter(Boolean).join(" · ") || name || "Schedule check";
    let label="Needs review", explanation=message, nextStep="Review the affected assignments, make any changes and recheck the schedule.";
    let destination: AttentionItem["destination"]="calendar";
    if (coverage) {
      const missing=number(issue.missing_count) ?? (number(details.required_count)!==null && number(details.valid_assignment_count)!==null ? Number(details.required_count)-Number(details.valid_assignment_count) : Number(message.match(/short by (\d+)/)?.[1]||1));
      label=`Needs ${Math.max(1,missing)} staff`;
      explanation="There is not enough staff coverage for this shift.";
      const available=rows(context.availability_days).filter(a=>a.available_date===date && a[type]===true);
      const people=staff.filter(s=>s.is_active===true && available.some(a=>a.staff_id===s.id));
      if (Array.isArray(context.availability_days) && people.length===0) explanation="No staff have submitted availability for this shift.";
      if (people.length===1) {
        const person=people[0], assigned=assignments.find(a=>a.staff_id===person.id && a.shift_id!==shiftId && shifts.some(s=>s.id===a.shift_id && s.shift_date===date));
        const other=shifts.find(s=>s.id===assigned?.shift_id);
        const phase=rows(context.training).find(t=>t.staff_id===person.id)?.phase;
        explanation=other?`Only ${str(person.full_name)} is available and already works that ${str(other.shift_type)}.`:
          phase==="phase_1_shadow_only"?`Only ${str(person.full_name)} is available and needs a trained colleague on the same shift.`:
          `Only ${str(person.full_name)} is available. Check their other assignments and scheduling rules before assigning them.`;
      }
      nextStep="Ask another qualified team member whether they can cover, or check whether Patrick can fill in.";destination="availability";
    } else if (/minimum|min_shifts/i.test(code+message)) {
      title=[name,day?`Week of ${reviewDate(day)}`:"Weekly workload"].filter(Boolean).join(" · ");label="Below weekly minimum";
      if (number(details.min_shifts_per_week)!==null && number(details.assigned_shift_count)!==null) explanation=`${name || "This staff member"} has ${details.assigned_shift_count} of ${details.min_shifts_per_week} required shifts this week.`;
      nextStep="Check their availability and add or move a shift. If they cannot work enough days, discuss their availability or contract setup.";destination="staff";
    } else if (/training|mentor|shadow|phase_/i.test(code+message)) {
      label="Training support needed";nextStep="Pair the trainee with an eligible trained colleague, or move their training shift.";destination="staff";
    } else if (/rest|consecutive|weekend|same.day|daily|maximum|target/i.test(code+message)) {
      label="Assignment conflict";nextStep="Move or swap an assignment, then recheck the schedule. Keep required rest and workload limits in place.";
    } else if (/availability|unavailable/i.test(code+message)) {
      label="Availability conflict";nextStep="Choose another staff member, or confirm a change with the person and update their availability first.";destination="availability";
    }
    items.push({id:key,title,label,explanation,nextStep,shiftId,destination});
  }
  if (input.cost!==null && input.budget!==null && input.cost>input.budget) {
    const amount=new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR"}).format(input.cost-input.budget);
    items.push({id:"budget",title:"Monthly budget",label:`${amount} over budget`,explanation:"The current draft exceeds the monthly staffing budget.",nextStep:"Review the assignments or update the budget with approval, then recheck the schedule.",shiftId:null,destination:"budget"});
  }
  const warnings=[...rows(input.issues).filter(x=>x.severity==="warning").map(x=>clean(x.message)),...(currentSnapshot?rows(validation.warnings).map(x=>clean(x.message)):[])].filter(Boolean);
  return {items,warnings:[...new Set(warnings)]};
}
