export type ScheduleMutationState = {
  status: "idle" | "success" | "error";
  message: string;
  runId?: string;
};

export const INITIAL_SCHEDULE_MUTATION_STATE: ScheduleMutationState = {
  status: "idle",
  message: "",
};

export type ScheduleBudgetFormField = "monthlyBudgetEur";

export type ScheduleBudgetMutationState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Partial<Record<ScheduleBudgetFormField, string>>;
};

export const INITIAL_SCHEDULE_BUDGET_MUTATION_STATE: ScheduleBudgetMutationState = {
  status: "idle",
  message: "",
};
