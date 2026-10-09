"""Unavoidable coverage gaps must not starve later workload objectives."""
from datetime import date
from app.models import PlanningContext
from app.generator.context import build_indexed_context
from app.generator.eligibility import build_candidate_assignments
from app.generator.model import build_solver_artifacts
from tests.test_engine_policy import generate
from tests.test_validate_v1 import (make_context, make_staff, make_contract, make_training,
    make_shift, STAFF_A, STAFF_B)


def bound(context):
    indexed=build_indexed_context(PlanningContext.model_validate(context))
    candidates,_=build_candidate_assignments(indexed,include_shadow_assignments=True)
    return build_solver_artifacts(indexed,candidates).coverage_shortfall_lower_bound


def test_trainee_only_gap_does_not_prevent_weekly_targets():
    context=make_context(staff=[make_staff(STAFF_A),make_staff(STAFF_B)],
        contracts=[make_contract(STAFF_A,min_shifts=2,target_shifts=2),
                   make_contract(STAFF_B,min_shifts=2,target_shifts=2)],
        training=[make_training(STAFF_A),make_training(STAFF_B,'phase_1_shadow_only')],
        shifts=[make_shift('unavoidable',date(2026,7,6),'morning')])
    for row in context['availability_days']:
        if row['staff_id']==STAFF_A and row['available_date']=='2026-07-06':
            row['morning']=False
    assert bound(context)==1
    result=generate(context)
    assert result.generation_status.value=='needs_manager_review'
    assert [e.code for e in result.validation.errors]==['mandatory_shift_uncovered']
    assert len(result.solver.stages)==9
    assert result.solver.stages[0]['objective_value']==result.solver.stages[0]['best_bound']==1
    assert result.solver.objective_values['weekly_minimum_shortfall']==0
    assert result.solver.objective_values['weekly_target_shortfall']==0
    assert sum(a.assignment_kind=='shadow' for a in result.draft_assignments)==2


def test_multi_place_shortfall_counts_people_not_just_empty_shifts():
    context=make_context(shifts=[make_shift('needs-three',date(2026,7,6),'morning',required_count=3)])
    assert bound(context)==2


def test_shadow_capacity_never_reduces_bound():
    context=make_context(staff=[make_staff(STAFF_A),make_staff(STAFF_B)],
        contracts=[make_contract(STAFF_A),make_contract(STAFF_B)],
        training=[make_training(STAFF_A),make_training(STAFF_B,'phase_1_shadow_only')],
        shifts=[make_shift('needs-two',date(2026,7,6),'morning',required_count=2)])
    assert bound(context)==1


def test_optional_empty_shifts_do_not_raise_coverage_bound():
    context=make_context(staff=[],contracts=[],training=[],
        shifts=[make_shift('optional',date(2026,7,6),'day',required_count=3,optional=True)])
    assert bound(context)==0


def test_shared_candidates_do_not_falsely_prove_zero_shortfall():
    context=make_context(shifts=[make_shift('morning',date(2026,7,6),'morning'),
        make_shift('evening',date(2026,7,6),'evening')])
    assert bound(context)==0  # Each has a candidate, but only one can be worked.
    result=generate(context,allow_optional_day_shifts=False)
    assert result.solver.stages[0]['objective_value']==1
    assert result.generation_status.value=='needs_manager_review'
