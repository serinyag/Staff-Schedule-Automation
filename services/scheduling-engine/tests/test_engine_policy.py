from datetime import date, timedelta
from copy import deepcopy
from types import SimpleNamespace
from uuid import UUID

import app.generator.service as service
from app.models import GenerateScheduleRequest, PlanningContext
from app.validator import validate_schedule
from app.models.draft_plan import DraftAssignment
from tests.test_validate_v1 import (make_context, make_staff, make_contract, make_training,
    make_shift, make_availability_day, make_assignment, STAFF_A, STAFF_B, PERIOD_ID)


def generate(context, **config):
    request = GenerateScheduleRequest.model_validate(dict(generation_run_id=PERIOD_ID, period_id=PERIOD_ID,
        rules_version='2', planning_context=context,
        engine_configuration={'max_solve_seconds': 5, **config}))
    return service.generate_schedule(request, engine_version='test', rules_version='2').response


def test_proposes_only_needed_day_shifts_and_preserves_input():
    context = make_context(staff=[make_staff(STAFF_A), make_staff(STAFF_B)],
        contracts=[make_contract(STAFF_A,min_shifts=1),make_contract(STAFF_B,min_shifts=1)],
        training=[make_training(STAFF_A),make_training(STAFF_B)])
    original=deepcopy(context)
    result=generate(context)
    assert context==original
    assert result.validation.valid
    assert len(result.draft_assignments)==2
    assert len(result.proposed_shifts)==1
    assert result.proposed_shifts[0].shift_type.value=='day'
    assert result.proposed_shifts[0].id in {a.shift_id for a in result.draft_assignments}


def test_does_not_create_unnecessary_days():
    result=generate(make_context())
    assert len(result.draft_assignments)==1
    assert result.proposed_shifts==[]


def test_scheduling_role_drives_host_preference_not_work_role():
    host=make_staff(STAFF_B);host.update(work_role='core_team',scheduling_rule_role='host')
    core=make_staff(STAFF_A);core.update(work_role='host',scheduling_rule_role='core_team')
    context=make_context(staff=[core,host], contracts=[make_contract(STAFF_A),make_contract(STAFF_B)],
        training=[make_training(STAFF_A),make_training(STAFF_B)],
        shifts=[make_shift('evening',date(2026,7,10),'evening')])
    context['role_rules']=[{'scheduling_rule_role':'host','is_active':True,'raw':{'evening_priority':100,'friday_priority':100}},
        {'scheduling_rule_role':'core_team','raw':{'evening_priority':50,'friday_priority':25}}]
    result=generate(context,allow_optional_day_shifts=False)
    assert result.draft_assignments[0].staff_id==UUID(STAFF_B)


def test_core_full_weekend_block_is_enforced_and_validated():
    staff=make_staff(STAFF_A);staff['scheduling_rule_role']='core_team'
    shifts=[make_shift('sat',date(2026,7,11),'morning'),make_shift('sun',date(2026,7,12),'morning')]
    context=make_context(staff=[staff],shifts=shifts,contracts=[make_contract(STAFF_A,target_shifts=2)])
    context['role_rules']=[{'scheduling_rule_role':'core_team','raw':{'block_full_weekend':True}}]
    result=generate(context,allow_optional_day_shifts=False)
    assert len(result.draft_assignments)==1
    assert result.generation_status.value=='needs_manager_review'
    validation=validate_schedule(planning_context=PlanningContext.model_validate(context),
        assignments=[DraftAssignment.model_validate(make_assignment(s,STAFF_A)) for s in ['sat','sun']],engine_version='test',rules_version='2')
    assert any(x.code=='role_full_weekend_blocked' for x in validation.errors)


def test_boundary_rest_blocks_previous_evening_and_next_morning():
    context=make_context(period_start=date(2026,7,6),period_end=date(2026,7,12),
        shifts=[make_shift('first',date(2026,7,6),'morning'),make_shift('last',date(2026,7,12),'evening')],
        contracts=[make_contract(STAFF_A,target_shifts=2)])
    context['boundary_assignments']=[{'staff_id':STAFF_A,'shift_date':'2026-07-05','shift_type':'evening'},
        {'staff_id':STAFF_A,'shift_date':'2026-07-13','shift_type':'morning'}]
    result=generate(context,allow_optional_day_shifts=False)
    assert not result.draft_assignments
    assert len(result.draft_plan.uncovered_shifts)==2


def test_boundary_consecutive_days_are_counted():
    context=make_context(shifts=[make_shift('first',date(2026,7,6),'day',optional=True)])
    context['boundary_assignments']=[{'staff_id':STAFF_A,'shift_date':f'2026-07-0{d}','shift_type':'morning'} for d in range(1,6)]
    result=generate(context,allow_optional_day_shifts=False)
    assert not result.draft_assignments


def test_partial_week_caps_include_fixed_neighbouring_assignments():
    context=make_context(period_start=date(2026,7,8),period_end=date(2026,7,8),
        shifts=[make_shift('wed',date(2026,7,8),'morning')],contracts=[make_contract(STAFF_A,max_shifts=2,target_shifts=2)])
    context['boundary_assignments']=[{'staff_id':STAFF_A,'shift_date':f'2026-07-0{d}','shift_type':'morning'} for d in (6,7)]
    result=generate(context,allow_optional_day_shifts=False)
    assert not result.draft_assignments


def test_missing_budget_is_review_required_not_optimal():
    result=generate(make_context(budget=None))
    assert result.validation.valid
    assert not result.validation.ready_for_commit
    assert result.generation_status.value=='needs_manager_review'
    assert any(i.code=='missing_monthly_budget' for i in result.validation.review_items)


def test_soft_consecutive_preference_avoids_unnecessary_streak():
    context=make_context(shifts=[], contracts=[make_contract(STAFF_A,min_shifts=4,target_shifts=4)],
        settings={'default_hard_max_consecutive_days':5,'default_soft_max_consecutive_days':2})
    result=generate(context)
    assert result.validation.valid
    assert not any(i.code=='soft_consecutive_day_limit_exceeded' for i in result.validation.warnings)
    assert len(result.draft_assignments)==4


def test_timeout_keeps_previous_solution_and_reports_feasible(monkeypatch):
    real=service.solve_stage
    calls=[]
    def timed(*args,**kwargs):
        calls.append(args[1])
        if len(calls)==2:
            return SimpleNamespace(status_name='UNKNOWN',objective_value=0,wall_time_seconds=0,best_bound=0,
                solver=SimpleNamespace(BestObjectiveBound=lambda:0))
        return real(*args,**kwargs)
    monkeypatch.setattr(service,'solve_stage',timed)
    result=generate(make_context(),allow_optional_day_shifts=False)
    assert len(result.draft_assignments)==1
    assert result.generation_status.value=='feasible'
    assert result.solver.status=='FEASIBLE'
    assert result.solver.stages[-1]['status']=='UNKNOWN'
    assert 'weekly_minimum_shortfall' not in result.solver.objective_values
