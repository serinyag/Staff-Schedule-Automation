from datetime import date
from collections import Counter
from app.generator.flexible import monthly_allowances, flexible_context, comparison
from app.models import PlanningContext
from tests.test_engine_policy import generate
from tests.test_validate_v1 import make_context, make_staff, make_contract, make_shift, STAFF_A


def test_monthly_allowance_rounding_and_partial_contract():
    context = make_context(period_start=date(2026,8,1), period_end=date(2026,8,31),
        staff=[make_staff(STAFF_A)], contracts=[make_contract(STAFF_A,target_shifts=2,end=None)])
    parsed = PlanningContext.model_validate(context)
    assert monthly_allowances(parsed)[STAFF_A] == 9
    parsed.contracts[0].start_date = date(2026,8,18)
    assert monthly_allowances(parsed)[STAFF_A] == 4


def test_flexible_preserves_original_and_weekly_maximum():
    context=PlanningContext.model_validate(make_context(staff=[make_staff(STAFF_A)], contracts=[make_contract(STAFF_A,min_shifts=2,target_shifts=2,max_shifts=3)]))
    original=context.model_dump()
    flexible,caps=flexible_context(context)
    assert context.model_dump()==original
    assert flexible.contracts[0].min_shifts_per_week==0
    assert flexible.contracts[0].max_shifts_per_week==3
    assert caps[STAFF_A] >= 0


def test_generated_flexible_draft_never_exceeds_monthly_cap():
    context=PlanningContext.model_validate(make_context(period_start=date(2026,7,6), period_end=date(2026,7,19),
        staff=[make_staff(STAFF_A)], contracts=[make_contract(STAFF_A,min_shifts=1,target_shifts=1,max_shifts=3,end=None)],
        shifts=[make_shift(str(d),date(2026,7,d),'morning') for d in [6,7,8,13,14,15]]))
    flexible,caps=flexible_context(context)
    result=generate(flexible.model_dump(mode='json'),allow_optional_day_shifts=False)
    counts=Counter(str(a.staff_id) for a in result.draft_assignments)
    assert counts[STAFF_A]==caps[STAFF_A]==2
    assert all(e.code == "mandatory_shift_uncovered" for e in result.validation.errors)
    review=comparison(context,[],result.model_dump(mode='json'),caps)
    assert review['staff'][0]['after']==2
    assert len(review['staff'][0]['added'])==2


def test_flexible_moves_work_into_available_week_without_raising_weekly_max():
    from tests.test_validate_v1 import make_availability_day
    raw=make_context(period_start=date(2026,7,6),period_end=date(2026,7,19),
        staff=[make_staff(STAFF_A)], contracts=[make_contract(STAFF_A,min_shifts=2,target_shifts=2,max_shifts=3,end=None)],
        shifts=[make_shift(str(d),date(2026,7,d),'morning') for d in [13,14,15,16]],
        availability_days=[make_availability_day(STAFF_A,date(2026,7,d)) for d in [13,14,15,16]])
    standard=generate(raw,allow_optional_day_shifts=False)
    flex,caps=flexible_context(PlanningContext.model_validate(raw))
    alternative=generate(flex.model_dump(mode='json'),allow_optional_day_shifts=False)
    assert len(standard.draft_assignments)==2
    assert len(alternative.draft_assignments)==3
    assert len(alternative.draft_assignments)<=caps[STAFF_A]==4
    assert not any(x.code=='weekly_maximum_exceeded' for x in alternative.validation.errors)
