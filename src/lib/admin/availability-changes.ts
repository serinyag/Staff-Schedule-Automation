export type SubmittedAvailabilityRevision = {
  id: string; staff_id: string; kind: string; created_at: string;
  reviewed_at?: string | null; daily_availability: unknown;
  willing_to_work_above_target: boolean; max_extra_shifts_for_period: number | null;
};
function fingerprint(row: SubmittedAvailabilityRevision) {
  const days = Array.isArray(row.daily_availability) ? row.daily_availability.map(day => ({
    available_date: day.available_date, morning: day.morning, day: day.day, evening: day.evening,
  })).sort((a,b) => String(a.available_date).localeCompare(String(b.available_date))) : [];
  return JSON.stringify([days, row.willing_to_work_above_target, row.max_extra_shifts_for_period ?? 0]);
}
// Review invalidation from assignment edits is deliberately separate from availability changes.
export function findAvailabilityChanges(rows: SubmittedAvailabilityRevision[], reviewedAt: string | null) {
  if (!reviewedAt) return [];
  const baselineTime = Date.parse(reviewedAt);
  const effective = rows.filter(row => row.kind === 'submitted' || row.kind === 'approved')
    .sort((a,b) => Date.parse(a.reviewed_at || a.created_at) - Date.parse(b.reviewed_at || b.created_at));
  const baseline = new Map<string, SubmittedAvailabilityRevision>();
  const latest = new Map<string, SubmittedAvailabilityRevision>();
  for (const row of effective) {
    const previous = latest.get(row.staff_id);
    if (!previous || fingerprint(previous) !== fingerprint(row)) latest.set(row.staff_id, row);
    if (Date.parse(row.reviewed_at || row.created_at) <= baselineTime) baseline.set(row.staff_id,row);
  }
  return [...latest.values()].filter(row => {
    const previous = baseline.get(row.staff_id);
    return previous && Date.parse(row.reviewed_at || row.created_at) > baselineTime && fingerprint(row) !== fingerprint(previous);
  }).map(row => ({staffId: row.staff_id, revisionId: row.id}));
}
