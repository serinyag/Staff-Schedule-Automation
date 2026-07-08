-- Canonical read-only planning input contract for one schedule period.
-- This RPC is intended for trusted orchestration and agent workflows that
-- need stable, versioned scheduling inputs from Supabase.

create or replace function public.get_schedule_planning_context(
  p_period_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period public.schedule_periods%rowtype;
begin
  if p_period_id is null then
    raise exception 'Schedule period id is required.'
      using errcode = 'P0001';
  end if;

  select sp.*
    into v_period
  from public.schedule_periods sp
  where sp.id = p_period_id;

  if v_period.id is null then
    raise exception 'The selected schedule period could not be found.'
      using errcode = 'P0002';
  end if;

  return (
    with relevant_staff as (
      select
        sm.id,
        sm.full_name,
        sm.work_role,
        sm.scheduling_rule_role,
        sm.hourly_rate,
        sm.is_active,
        sm.is_wildcard_fill_in,
        sm.is_initial_training_mentor,
        sm.default_weekly_budget_shifts
      from public.staff_members sm
      where sm.is_active is true
    ),
    relevant_contracts as (
      select
        ec.id,
        ec.staff_id,
        ec.start_date,
        ec.end_date,
        ec.min_shifts_per_week,
        ec.target_shifts_per_week,
        ec.max_shifts_per_week,
        ec.standard_shift_hours,
        ec.notes,
        ec.created_at,
        ec.updated_at
      from public.employment_contracts ec
      join relevant_staff rs
        on rs.id = ec.staff_id
      where ec.start_date <= v_period.end_date
        and (ec.end_date is null or ec.end_date >= v_period.start_date)
    ),
    overlapping_contract_staff as (
      select distinct left_contract.staff_id
      from relevant_contracts left_contract
      join relevant_contracts right_contract
        on right_contract.staff_id = left_contract.staff_id
       and right_contract.id > left_contract.id
       and daterange(
             left_contract.start_date,
             coalesce(left_contract.end_date, 'infinity'::date),
             '[]'
           ) && daterange(
             right_contract.start_date,
             coalesce(right_contract.end_date, 'infinity'::date),
             '[]'
           )
    ),
    relevant_training as (
      select
        sts.staff_id,
        sts.phase,
        sts.training_started_on,
        sts.target_completion_on,
        sts.phase_started_on,
        sts.fully_trained_on,
        sts.updated_by,
        sts.notes,
        sts.updated_at
      from public.staff_training_status sts
      join relevant_staff rs
        on rs.id = sts.staff_id
    ),
    singleton_settings_rows as (
      select
        ss.singleton,
        ss.holiday_streak_days,
        ss.default_soft_max_consecutive_days,
        ss.default_hard_max_consecutive_days,
        ss.min_days_off_per_week_high_commitment,
        ss.high_commitment_threshold_shifts_per_week,
        ss.block_evening_to_next_morning,
        ss.initial_mentor_shift_count,
        ss.min_morning_coverage,
        ss.min_evening_coverage,
        ss.updated_at
      from public.scheduling_settings ss
      where ss.singleton is true
    ),
    exact_settings as (
      select *
      from singleton_settings_rows
      order by updated_at desc
      limit 1
    ),
    relevant_submissions as (
      select
        submission.id,
        submission.period_id,
        submission.staff_id,
        submission.status,
        submission.willing_to_work_above_target,
        submission.max_extra_shifts_for_period,
        submission.submitted_at,
        submission.created_at,
        submission.updated_at
      from public.availability_submissions submission
      join relevant_staff rs
        on rs.id = submission.staff_id
      where submission.period_id = p_period_id
        and submission.status = 'submitted'
    ),
    relevant_availability_days as (
      select
        day_row.id,
        day_row.submission_id,
        submission.staff_id,
        day_row.available_date,
        day_row.morning,
        day_row.day,
        day_row.evening,
        day_row.created_at,
        day_row.updated_at
      from public.availability_days day_row
      join relevant_submissions submission
        on submission.id = day_row.submission_id
    ),
    relevant_streaks as (
      select
        streak.staff_id,
        streak.period_id,
        streak.streak_start,
        streak.streak_end,
        streak.streak_days
      from public.availability_unavailable_streaks streak
      join relevant_staff rs
        on rs.id = streak.staff_id
      where streak.period_id = p_period_id
        and (
          (select count(*) from singleton_settings_rows) <> 1
          or streak.streak_days >= (select settings.holiday_streak_days from exact_settings settings)
        )
    ),
    relevant_budgets as (
      select
        budget.id,
        budget.period_id,
        budget.scope,
        budget.work_role,
        budget.staff_id,
        budget.max_shifts,
        budget.weekly_reference,
        budget.notes,
        budget.created_at,
        budget.updated_at
      from public.schedule_budgets budget
      where budget.period_id = p_period_id
    ),
    relevant_shifts as (
      select
        shift.id,
        shift.period_id,
        shift.shift_date,
        shift.shift_type,
        shift.start_time,
        shift.end_time,
        shift.required_count,
        shift.is_optional,
        shift.notes,
        shift.created_at,
        shift.updated_at
      from public.shifts shift
      where shift.period_id = p_period_id
    )
    select jsonb_build_object(
      'context_version', 1,
      'generated_at', to_jsonb(now()),
      'period_id', to_jsonb(v_period.id),
      'period', jsonb_build_object(
        'id', v_period.id,
        'name', v_period.name,
        'start_date', v_period.start_date,
        'end_date', v_period.end_date,
        'availability_deadline', v_period.availability_deadline,
        'monthly_staff_budget_eur', v_period.monthly_staff_budget_eur,
        'status', v_period.status,
        'published_at', v_period.published_at,
        'created_by', v_period.created_by,
        'created_at', v_period.created_at,
        'updated_at', v_period.updated_at
      ),
      'staff', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', rs.id,
              'full_name', rs.full_name,
              'work_role', rs.work_role,
              'scheduling_rule_role', rs.scheduling_rule_role,
              'hourly_rate', rs.hourly_rate,
              'is_active', rs.is_active,
              'is_wildcard_fill_in', rs.is_wildcard_fill_in,
              'is_initial_training_mentor', rs.is_initial_training_mentor,
              'default_weekly_budget_shifts', rs.default_weekly_budget_shifts
            )
            order by rs.full_name, rs.id
          )
          from relevant_staff rs
        ),
        '[]'::jsonb
      ),
      'contracts', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', rc.id,
              'staff_id', rc.staff_id,
              'start_date', rc.start_date,
              'end_date', rc.end_date,
              'min_shifts_per_week', rc.min_shifts_per_week,
              'target_shifts_per_week', rc.target_shifts_per_week,
              'max_shifts_per_week', rc.max_shifts_per_week,
              'standard_shift_hours', rc.standard_shift_hours,
              'notes', rc.notes,
              'created_at', rc.created_at,
              'updated_at', rc.updated_at
            )
            order by rc.staff_id, rc.start_date, coalesce(rc.end_date, 'infinity'::date), rc.id
          )
          from relevant_contracts rc
        ),
        '[]'::jsonb
      ),
      'training', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'staff_id', rt.staff_id,
              'phase', rt.phase,
              'training_started_on', rt.training_started_on,
              'target_completion_on', rt.target_completion_on,
              'phase_started_on', rt.phase_started_on,
              'fully_trained_on', rt.fully_trained_on,
              'updated_by', rt.updated_by,
              'notes', rt.notes,
              'updated_at', rt.updated_at
            )
            order by rt.staff_id
          )
          from relevant_training rt
        ),
        '[]'::jsonb
      ),
      'preferences', '[]'::jsonb,
      'role_rules', '[]'::jsonb,
      'settings', coalesce(
        (
          select case
            when (select count(*) from singleton_settings_rows) = 1 then jsonb_build_object(
              'singleton', settings.singleton,
              'holiday_streak_days', settings.holiday_streak_days,
              'default_soft_max_consecutive_days', settings.default_soft_max_consecutive_days,
              'default_hard_max_consecutive_days', settings.default_hard_max_consecutive_days,
              'min_days_off_per_week_high_commitment', settings.min_days_off_per_week_high_commitment,
              'high_commitment_threshold_shifts_per_week', settings.high_commitment_threshold_shifts_per_week,
              'block_evening_to_next_morning', settings.block_evening_to_next_morning,
              'initial_mentor_shift_count', settings.initial_mentor_shift_count,
              'min_morning_coverage', settings.min_morning_coverage,
              'min_evening_coverage', settings.min_evening_coverage,
              'updated_at', settings.updated_at
            )
            else '{}'::jsonb
          end
          from exact_settings settings
        ),
        '{}'::jsonb
      ),
      'availability_submissions', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', submission.id,
              'period_id', submission.period_id,
              'staff_id', submission.staff_id,
              'status', submission.status,
              'willing_to_work_above_target', submission.willing_to_work_above_target,
              'max_extra_shifts_for_period', submission.max_extra_shifts_for_period,
              'submitted_at', submission.submitted_at,
              'created_at', submission.created_at,
              'updated_at', submission.updated_at
            )
            order by submission.staff_id, submission.id
          )
          from relevant_submissions submission
        ),
        '[]'::jsonb
      ),
      'availability_days', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', day_row.id,
              'submission_id', day_row.submission_id,
              'staff_id', day_row.staff_id,
              'available_date', day_row.available_date,
              'morning', day_row.morning,
              'day', day_row.day,
              'evening', day_row.evening,
              'created_at', day_row.created_at,
              'updated_at', day_row.updated_at
            )
            order by day_row.available_date, day_row.staff_id, day_row.id
          )
          from relevant_availability_days day_row
        ),
        '[]'::jsonb
      ),
      'holiday_exemptions', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'staff_id', streak.staff_id,
              'period_id', streak.period_id,
              'streak_start', streak.streak_start,
              'streak_end', streak.streak_end,
              'streak_days', streak.streak_days
            )
            order by streak.streak_start, streak.staff_id, streak.streak_end
          )
          from relevant_streaks streak
        ),
        '[]'::jsonb
      ),
      'budgets', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', budget.id,
              'period_id', budget.period_id,
              'scope', budget.scope,
              'work_role', budget.work_role,
              'staff_id', budget.staff_id,
              'max_shifts', budget.max_shifts,
              'weekly_reference', budget.weekly_reference,
              'notes', budget.notes,
              'created_at', budget.created_at,
              'updated_at', budget.updated_at
            )
            order by
              case budget.scope
                when 'role' then 0
                when 'staff' then 1
                else 2
              end,
              coalesce(budget.work_role::text, ''),
              coalesce(budget.staff_id, ''),
              budget.id
          )
          from relevant_budgets budget
        ),
        '[]'::jsonb
      ),
      'shifts', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', shift.id,
              'period_id', shift.period_id,
              'shift_date', shift.shift_date,
              'shift_type', shift.shift_type,
              'start_time', shift.start_time,
              'end_time', shift.end_time,
              'required_count', shift.required_count,
              'is_optional', shift.is_optional,
              'notes', shift.notes,
              'created_at', shift.created_at,
              'updated_at', shift.updated_at
            )
            order by
              shift.shift_date,
              case shift.shift_type
                when 'morning' then 0
                when 'day' then 1
                when 'evening' then 2
                else 3
              end,
              shift.id
          )
          from relevant_shifts shift
        ),
        '[]'::jsonb
      ),
      'diagnostics', jsonb_build_object(
        'active_staff_count', (select count(*) from relevant_staff),
        'submitted_staff_count', (select count(distinct staff_id) from relevant_submissions),
        'missing_contract_staff_ids', coalesce(
          (
            select jsonb_agg(rs.id order by rs.id)
            from relevant_staff rs
            where not exists (
              select 1
              from relevant_contracts rc
              where rc.staff_id = rs.id
            )
          ),
          '[]'::jsonb
        ),
        'ambiguous_contract_staff_ids', coalesce(
          (
            select jsonb_agg(ocs.staff_id order by ocs.staff_id)
            from overlapping_contract_staff ocs
          ),
          '[]'::jsonb
        ),
        'missing_training_status_staff_ids', coalesce(
          (
            select jsonb_agg(rs.id order by rs.id)
            from relevant_staff rs
            where not exists (
              select 1
              from relevant_training rt
              where rt.staff_id = rs.id
            )
          ),
          '[]'::jsonb
        ),
        'missing_availability_staff_ids', coalesce(
          (
            select jsonb_agg(rs.id order by rs.id)
            from relevant_staff rs
            where not exists (
              select 1
              from relevant_submissions submission
              where submission.staff_id = rs.id
            )
          ),
          '[]'::jsonb
        ),
        'settings_singleton_row_count', (select count(*) from singleton_settings_rows)
      )
    )
  );
end;
$$;

comment on function public.get_schedule_planning_context(uuid) is
  'Canonical read-only planning input contract for one schedule period. Used by trusted orchestration and scheduling workflows.';

revoke all on function public.get_schedule_planning_context(uuid) from public;
grant execute on function public.get_schedule_planning_context(uuid) to authenticated;
