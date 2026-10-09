type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v as Row[] : [];
export function candidateNotes(staffId: string, date: string, shiftType: string, context: Row, assignments: Row[]): string[] {
  const start = new Date(date + 'T12:00:00Z');
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const from = start.toISOString().slice(0,10), to = end.toISOString().slice(0,10);
  const shifts = rows(context.shifts);
  const worked = assignments.filter(a => a.staff_id === staffId).flatMap(a => {
    const shift = shifts.find(s => s.id === a.shift_id);
    return shift ? [shift] : [];
  }).concat(rows(context.boundary_assignments).filter(a => a.staff_id === staffId));
  const notes = [...new Set(worked.filter(s => s.shift_date === date).map(s => `Already working ${s.shift_type} shift that day.`))];
  const count = worked.filter(s => String(s.shift_date) >= from && String(s.shift_date) <= to).length;
  const contract = rows(context.contracts).find(c => c.staff_id === staffId && String(c.start_date) <= date && (!c.end_date || String(c.end_date) >= date));
  notes.push(`Already scheduled for ${count} ${count === 1 ? 'shift' : 'shifts'} this week${contract ? ` (target ${contract.target_shifts_per_week}, maximum ${contract.max_shifts_per_week})` : ''}.`);
  if (contract && count >= Number(contract.max_shifts_per_week)) notes.push('Weekly maximum reached. Adding this shift would exceed it.');
  else if (contract && count >= Number(contract.target_shifts_per_week)) notes.push('Weekly target reached. Check agreement to extra shifts before adding another.');
  const previous = new Date(date + 'T12:00:00Z'); previous.setUTCDate(previous.getUTCDate()-1);
  const next = new Date(date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate()+1);
  const settings = context.settings as Row | undefined;
  if (settings?.block_evening_to_next_morning === true && (
    (shiftType === 'morning' && worked.some(s => s.shift_date === previous.toISOString().slice(0,10) && s.shift_type === 'evening')) ||
    (shiftType === 'evening' && worked.some(s => s.shift_date === next.toISOString().slice(0,10) && s.shift_type === 'morning'))
  )) notes.push('Conflicts with the evening-to-morning rest rule.');
  const person = rows(context.staff).find(s => s.id === staffId);
  const rule = rows(context.role_rules).find(r => r.is_active !== false && (r.scheduling_rule_role || r.work_role) === person?.scheduling_rule_role);
  const policy = {...(rule?.raw as Row), ...(rule?.rule_config as Row)};
  const weekday = new Date(date+'T12:00:00Z').getUTCDay();
  const otherWeekendDate = weekday === 6 ? next : previous;
  if ((weekday === 6 || weekday === 0) && policy.block_full_weekend === true && worked.some(s => s.shift_date === otherWeekendDate.toISOString().slice(0,10))) notes.push('Already working the other weekend day. Their rule allows only one day per weekend.');
  const phase = rows(context.training).find(t => t.staff_id === staffId)?.phase;
  if (phase === 'phase_1_shadow_only') notes.push('Needs a trained colleague on the same shift; does not count as primary coverage.');
  if (phase === 'phase_2_opening_independent' && shiftType === 'evening') notes.push('Needs a fully trained colleague for an evening shift.');
  return notes;
}
