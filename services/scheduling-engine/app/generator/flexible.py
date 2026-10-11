"""Explicit monthly redistribution policy; original contracts remain unchanged."""
from collections import Counter
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from app.models import PlanningContext


def monthly_allowances(context):
    caps = {}
    for staff in context.staff:
        total = Decimal(0)
        day = context.period.start_date
        while day <= context.period.end_date:
            contracts = [c for c in context.contracts if c.staff_id == staff.id and c.start_date <= day and (c.end_date is None or day <= c.end_date)]
            if len(contracts) > 1:
                raise ValueError('Overlapping contracts must be resolved before monthly redistribution.')
            if contracts:
                total += Decimal(contracts[0].target_shifts_per_week) / 7
            day += timedelta(days=1)
        caps[str(staff.id)] = int(total.quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    return caps


def flexible_context(context):
    data = context.model_dump(mode='json')
    caps = monthly_allowances(context)
    data['monthly_shift_caps'] = caps
    for contract in data['contracts']:
        contract['min_shifts_per_week'] = 0
        contract['target_shifts_per_week'] = contract['max_shifts_per_week']
    for submission in data['availability_submissions']:
        submission['willing_to_work_above_target'] = True
        submission['max_extra_shifts_for_period'] = None
    return PlanningContext.model_validate(data), caps


def comparison(context, baseline, result, caps):
    shifts = {str(s.id): s.model_dump(mode='json') for s in context.shifts}
    shifts.update({s['id']: s for s in result.get('proposed_shifts', [])})
    alternative = result['draft_assignments']
    old_pairs = {(a['staff_id'], a['shift_id']) for a in baseline}
    new_pairs = {(a['staff_id'], a['shift_id']) for a in alternative}
    def count(assignment_rows, sid, start, end):
        return sum(a['staff_id'] == sid and start <= shifts[a['shift_id']]['shift_date'] <= end for a in assignment_rows if a['shift_id'] in shifts)
    rows = []
    for staff in context.staff:
        sid = str(staff.id)
        weeks = []
        start = context.period.start_date - timedelta(days=context.period.start_date.weekday())
        while start <= context.period.end_date:
            end = start + timedelta(days=6)
            before, after = count(baseline, sid, start.isoformat(), end.isoformat()), count(alternative, sid, start.isoformat(), end.isoformat())
            contracts = [c for c in context.contracts if str(c.staff_id) == sid and c.start_date <= end and (c.end_date is None or c.end_date >= start)]
            minimum = contracts[0].min_shifts_per_week if contracts else 0
            if before != after or (before < minimum and start >= context.period.start_date and end <= context.period.end_date):
                available = [a.available_date.isoformat() for a in context.availability_days if str(a.staff_id) == sid and start <= a.available_date <= end and (a.morning or a.day or a.evening)]
                weeks.append({'week':start.isoformat(), 'before':before, 'after':after, 'available_dates':sorted(set(available)),
                    'reason': ('The standard draft is below the weekly minimum of %s; submitted availability covers %s day(s). Monthly redistribution can place work in other available weeks.' % (minimum, len(set(available)))) if before < minimum else ('Additional shifts on available dates within the monthly allowance.' if after > before else 'Fewer shifts here to redistribute work across the month while preserving coverage and scheduling rules.')})
            start += timedelta(days=7)
        added = [dict(shifts[shift_id], previously_uncovered=not any(a['shift_id']==shift_id and a.get('assignment_kind','coverage')=='coverage' for a in baseline)) for staff_id,shift_id in sorted(new_pairs-old_pairs) if staff_id==sid]
        for added_shift in added:
            added_shift['unavailable_staff'] = [s.full_name for s in context.staff if str(s.id) != sid and not any(
                a.staff_id == s.id and a.available_date.isoformat() == added_shift['shift_date'] and getattr(a, added_shift['shift_type'], False)
                for a in context.availability_days)]
        removed = [shifts[shift_id] for staff_id,shift_id in sorted(old_pairs-new_pairs) if staff_id==sid]
        before = count(baseline,sid,context.period.start_date.isoformat(),context.period.end_date.isoformat())
        after = count(alternative,sid,context.period.start_date.isoformat(),context.period.end_date.isoformat())
        if after > caps[sid]:
            raise ValueError('Monthly allowance exceeded.')
        rows.append({'name':staff.full_name,'before':before,'after':after,'allowance':caps[sid],'weeks':weeks,'added':added,'removed':removed})
    required = {k for k,s in shifts.items() if not s.get('is_optional') and s['shift_type'] in ('morning','evening')}
    def gaps(assignments):
        counts=Counter(a['shift_id'] for a in assignments if a.get('assignment_kind','coverage')=='coverage')
        return sum(max(0,shifts[k]['required_count']-counts[k]) for k in required)
    return {'staff':rows,'standard_gaps':gaps(baseline),'flexible_gaps':gaps(alternative),'standard_assignments':baseline,
        'monthly_formula':'Weekly target × contract-active days in this period ÷ 7, rounded to the nearest whole shift (halves round up).',
        'policy':'Weekly targets and minimums may move between weeks. Weekly maximums, rest, availability, training and weekend restrictions remain in force.'}
