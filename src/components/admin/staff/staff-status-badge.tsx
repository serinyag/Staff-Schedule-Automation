type StaffStatusBadgeProps = {
  isActive: boolean;
};

export function StaffStatusBadge({ isActive }: StaffStatusBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-xs font-semibold",
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
