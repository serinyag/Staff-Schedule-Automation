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


def solve_stage(
    model: cp_model.CpModel,
    objective_name: str,
    objective_expr: cp_model.LinearExpr,
    *,
    deadline_monotonic: float,
    random_seed: int,
) -> SolveStageResult:
    remaining_seconds = max(0.01, deadline_monotonic - time.monotonic())
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = remaining_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = random_seed
    model.Minimize(objective_expr)
    status = solver.Solve(model)
    status_name = solver.StatusName(status)
    if status not in {cp_model.OPTIMAL, cp_model.FEASIBLE}:
        return SolveStageResult(
            status_name=status_name,
            objective_value=0,
            wall_time_seconds=solver.WallTime(),
            solver=solver,
        )
    objective_value = int(round(solver.ObjectiveValue()))
    model.Add(objective_expr == objective_value)
    return SolveStageResult(
        status_name=status_name,
        objective_value=objective_value,
        wall_time_seconds=solver.WallTime(),
        solver=solver,
    )
