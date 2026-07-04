import { formatPhaseLabel, type StaffAdminRecord } from "@/lib/admin/staff";

type TrainingPhaseBadgeProps = {
  training: StaffAdminRecord["training"];
};

export function TrainingPhaseBadge({ training }: TrainingPhaseBadgeProps) {
  if (!training) {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        No training row
      </span>
    );
  }

  const palette =
    training.phase === "phase_3_fully_trained"
      ? "bg-emerald-100 text-emerald-800"
      : training.phase === "phase_2_opening_independent"
        ? "bg-amber-100 text-amber-800"
        : "bg-sky-100 text-sky-800";

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.01em] ${palette}`}>
      {formatPhaseLabel(training.phase)}
    </span>
  );
}
