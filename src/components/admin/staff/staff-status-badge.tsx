type StaffStatusBadgeProps = {
  isActive: boolean;
};

export function StaffStatusBadge({ isActive }: StaffStatusBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
        isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600",
      ].join(" ")}
    >
      <span
        className={[
          "h-2 w-2 rounded-full",
          isActive ? "bg-emerald-500" : "bg-slate-400",
        ].join(" ")}
      />
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}
