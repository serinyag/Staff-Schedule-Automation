const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
export type AssignmentCommand = { action: "assign" | "move" | "remove"; periodId: string; shiftId?: string; staffId?: string; assignmentId?: string; targetShiftId?: string };
export function isAssignmentCommand(value: unknown): value is AssignmentCommand {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return isUuid(b.periodId) && (b.action === "assign" ? isUuid(b.shiftId) && isUuid(b.staffId) :
    b.action === "move" ? isUuid(b.assignmentId) && isUuid(b.targetShiftId) : b.action === "remove" && isUuid(b.assignmentId));
}
export type DayShiftCommand = { action: "create" | "delete"; periodId: string; dateKey?: string; shiftId?: string };
export function isDayShiftCommand(value: unknown): value is DayShiftCommand {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return isUuid(b.periodId) && (b.action === "delete" ? isUuid(b.shiftId) :
    b.action === "create" && b.shiftType === "day" && typeof b.dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.dateKey)
    && Number.isFinite(Date.parse(b.dateKey)) && new Date(b.dateKey).toISOString().slice(0,10) === b.dateKey);
}
