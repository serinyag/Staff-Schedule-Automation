"""Shared role policy and deterministic, unpersisted day-shift proposals."""
from datetime import timedelta
from uuid import uuid5
from app.models import PlanningContext, Shift, ShiftType


def role_policy(context, staff):
    for rule in context.role_rules:
        if rule.get('is_active', True) and rule.get('scheduling_rule_role', rule.get('work_role')) == staff.scheduling_rule_role:
            return {**rule.get('raw', {}), **rule.get('rule_config', {})}
    return {}


def shift_priority(context, staff, shift):
    policy = role_policy(context, staff)
    keys = []
    if shift.shift_type == ShiftType.EVENING:
        keys.append('evening_priority')
    if shift.shift_date.weekday() == 4:
        keys.append('friday_priority')
    if shift.shift_date.weekday() >= 5:
        keys.append('weekend_priority')
    return sum(max(0, min(100, int(policy.get(key, 0)))) for key in keys)


def with_optional_days(context: PlanningContext):
    """Only selected proposals are persisted by the atomic database writer."""
    existing = {s.shift_date for s in context.shifts if s.shift_type == ShiftType.DAY}
    proposals = []
    current = context.period.start_date
    while current <= context.period.end_date:
        if current not in existing:
            proposals.append(Shift(id=uuid5(context.period.id, f'optional-day:{current}'),
                period_id=context.period.id, shift_date=current, shift_type=ShiftType.DAY,
                is_optional=True, required_count=1))
        current += timedelta(days=1)
    return context.model_copy(update={'shifts': [*context.shifts, *proposals]}), proposals
