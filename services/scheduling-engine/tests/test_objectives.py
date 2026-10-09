"""Stage bounds must advance zero shortfalls without hiding incomplete solves."""
import time
from ortools.sat.python import cp_model
from app.generator.objectives import solve_stage


def solve(model, expr, lower_bound=None):
    return solve_stage(model, 'test', expr, deadline_monotonic=time.monotonic()+2,
                       random_seed=42, known_lower_bound=lower_bound)


def test_zero_shortfall_is_proven_optimal_and_next_stage_runs():
    model=cp_model.CpModel()
    missing=model.NewIntVar(0, 5, 'missing')
    cost=model.NewIntVar(0, 5, 'cost')
    model.Add(missing+cost>=3)
    first=solve(model, missing, 0)
    assert first.status_name=='OPTIMAL'
    assert first.objective_value==first.best_bound==0
    second=solve(model, cost)
    assert second.status_name=='OPTIMAL'
    assert second.objective_value==3
    assert second.solver.Value(missing)==0


def test_impossible_zero_shortfall_is_not_fabricated():
    model=cp_model.CpModel()
    missing=model.NewIntVar(0, 5, 'missing')
    model.Add(missing>=2)
    result=solve(model, missing, 0)
    assert result.status_name=='OPTIMAL'
    assert result.objective_value==result.best_bound==2


def test_preference_objective_can_be_negative():
    model=cp_model.CpModel()
    preference=model.NewIntVar(-5, 0, 'preference')
    result=solve(model, preference)
    assert result.objective_value==result.best_bound==-5


def test_infeasible_model_does_not_report_bound_as_solution():
    model=cp_model.CpModel()
    missing=model.NewIntVar(0, 5, 'missing')
    model.Add(missing<0)
    assert solve(model, missing, 0).status_name=='INFEASIBLE'


def test_feasible_zero_with_loose_solver_bound_is_recognized(monkeypatch):
    # Reproduce the old stage result: a zero incumbent, FEASIBLE, loose -10 bound.
    original=cp_model.CpSolver.Solve
    def feasible(self, model, callback=None):
        status=original(self, model, callback)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        return cp_model.FEASIBLE
    monkeypatch.setattr(cp_model.CpSolver, 'Solve', feasible)
    monkeypatch.setattr(cp_model.CpSolver, 'BestObjectiveBound', lambda self: -10)
    model=cp_model.CpModel()
    missing=model.NewIntVar(0, 5, 'missing')
    result=solve(model, missing, 0)
    assert result.status_name=='OPTIMAL'
    assert result.objective_value==result.best_bound==0


def test_nonzero_feasible_incumbent_is_not_claimed_optimal(monkeypatch):
    original=cp_model.CpSolver.Solve
    def feasible(self, model, callback=None):
        original(self, model, callback)
        return cp_model.FEASIBLE
    monkeypatch.setattr(cp_model.CpSolver, 'Solve', feasible)
    monkeypatch.setattr(cp_model.CpSolver, 'BestObjectiveBound', lambda self: 0)
    model=cp_model.CpModel()
    missing=model.NewIntVar(2, 5, 'missing')
    result=solve(model, missing, 0)
    assert result.status_name=='FEASIBLE'
    assert result.objective_value==2
    assert result.best_bound==0
