"""Compare daily matching to exhaustive legal allocations, not greedy guesses."""
from itertools import product
from uuid import UUID
from datetime import date
from app.generator.capacity import maximum_daily_coverage
from tests.test_coverage_bound import bound
from tests.test_engine_policy import generate
from tests.test_validate_v1 import make_context, make_shift, make_contract, STAFF_A

A,B,C=[UUID(int=n) for n in range(1,4)]


def test_augmenting_path_recovers_full_capacity():
    assert maximum_daily_coverage([{A,B},{A}])==2


def test_hall_bottleneck_despite_enough_total_staff():
    assert maximum_daily_coverage([{A},{A},{B,C}])==2


def test_all_small_graphs_match_exhaustive_assignment_search():
    staff=[A,B,C]
    for edges in product([False,True],repeat=9):
        slots=[{staff[j] for j in range(3) if edges[i*3+j]} for i in range(3)]
        legal=[sum(p is not None for p in assignment)
               for assignment in product(*[[None,*slot] for slot in slots])
               if len([p for p in assignment if p is not None])==len({p for p in assignment if p is not None})]
        assert maximum_daily_coverage(slots)==max(legal)


def test_shared_daily_capacity_advances_to_weekly_workloads():
    c=make_context(shifts=[make_shift('morning',date(2026,7,6),'morning'),
        make_shift('evening',date(2026,7,6),'evening')],
        contracts=[make_contract(STAFF_A,min_shifts=2,target_shifts=2)])
    r=generate(c)
    assert bound(c)==1
    assert len(r.solver.stages)==9
    assert r.solver.stages[0]['objective_value']==r.solver.stages[0]['best_bound']==1
    assert r.solver.objective_values['weekly_minimum_shortfall']==0
    assert r.solver.objective_values['weekly_target_shortfall']==0
    assert [x.code for x in r.validation.errors]==['mandatory_shift_uncovered']


def test_same_person_can_cover_different_dates():
    c=make_context(shifts=[make_shift('one',date(2026,7,6),'morning'),
        make_shift('two',date(2026,7,7),'morning')])
    assert bound(c)==0


def test_rest_conflict_is_not_falsely_claimed_solved_by_daily_bound():
    c=make_context(shifts=[make_shift('one',date(2026,7,6),'evening'),
        make_shift('two',date(2026,7,7),'morning')])
    assert bound(c)==0
    r=generate(c,allow_optional_day_shifts=False)
    assert r.solver.stages[0]['objective_value']==1
    assert r.generation_status.value=='needs_manager_review'
