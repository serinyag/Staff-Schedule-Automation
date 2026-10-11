from __future__ import annotations

import time
from dataclasses import dataclass

from ortools.sat.python import cp_model


@dataclass(frozen=True)
class SolveStageResult:
    status_name: str
    objective_value: int
    wall_time_seconds: float
    solver: cp_model.CpSolver
    best_bound: float


class _StopAtLowerBound(cp_model.CpSolverSolutionCallback):
    """A feasible solution at a proven lower bound is globally optimal."""

    def __init__(self, lower_bound: int) -> None:
        super().__init__()
        self.lower_bound = lower_bound

    def on_solution_callback(self) -> None:
        if self.ObjectiveValue() <= self.lower_bound:
            self.StopSearch()


def solve_stage(
    model: cp_model.CpModel,
    objective_name: str,
    objective_expr: cp_model.LinearExpr,
    *,
    deadline_monotonic: float,
    random_seed: int,
    known_lower_bound: int | None = None,
) -> SolveStageResult:
    remaining_seconds = max(0.01, deadline_monotonic - time.monotonic())
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = remaining_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = random_seed
    model.Minimize(objective_expr)
    if known_lower_bound is not None:
        # Make the structural bound explicit for presolve and diagnostics.
        model.Add(objective_expr >= known_lower_bound)
    callback = _StopAtLowerBound(known_lower_bound) if known_lower_bound is not None else None
    status = solver.Solve(model, callback)
    best_bound = solver.BestObjectiveBound()
    if known_lower_bound is not None:
        best_bound = max(best_bound, known_lower_bound)
    status_name = solver.StatusName(status)
    if status not in {cp_model.OPTIMAL, cp_model.FEASIBLE}:
        return SolveStageResult(
            status_name=status_name,
            objective_value=0,
            wall_time_seconds=solver.WallTime(),
            solver=solver,
            best_bound=best_bound,
        )
    objective_value = int(round(solver.ObjectiveValue()))
    if known_lower_bound is not None and objective_value == known_lower_bound:
        status_name = "OPTIMAL"
        best_bound = objective_value
    model.Add(objective_expr == objective_value)
    return SolveStageResult(
        status_name=status_name,
        objective_value=objective_value,
        wall_time_seconds=solver.WallTime(),
        solver=solver,
        best_bound=best_bound,
    )
