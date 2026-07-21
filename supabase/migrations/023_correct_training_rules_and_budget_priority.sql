comment on column public.scheduling_settings.initial_mentor_shift_count is
  'Legacy compatibility field retained for older consumers. Generation and validation ignore it; Phase 1 shadow training now only requires a same-shift Phase 3 trainer.';

comment on column public.staff_members.is_initial_training_mentor is
  'Deprecated compatibility field retained for older consumers. Generation and validation no longer require or prefer a designated initial mentor.';

alter table public.scheduling_settings
  alter column initial_mentor_shift_count set default 0,
  add column if not exists budget_policy jsonb not null default jsonb_build_object(
    'allow_overage_for_mandatory_coverage', true,
    'allow_overage_for_weekly_minimums', true,
    'allow_overage_for_required_training', true,
    'allow_overage_for_weekly_targets', false,
    'allow_overage_for_soft_quality', false,
    'minimize_required_overage', true,
    'overage_requires_manager_review', true
  );

comment on column public.scheduling_settings.budget_policy is
  'Authoritative budget policy overrides for schedule generation and validation. The period monthly_staff_budget_eur remains the configured baseline threshold.';

update public.scheduling_settings
set initial_mentor_shift_count = 0,
    budget_policy = coalesce(budget_policy, '{}'::jsonb) || jsonb_build_object(
      'allow_overage_for_mandatory_coverage', true,
      'allow_overage_for_weekly_minimums', true,
      'allow_overage_for_required_training', true,
      'allow_overage_for_weekly_targets', false,
      'allow_overage_for_soft_quality', false,
      'minimize_required_overage', true,
      'overage_requires_manager_review', true
    ),
    updated_at = now()
where singleton is true
  and (
    coalesce(initial_mentor_shift_count, 0) <> 0
    or budget_policy is null
    or budget_policy = '{}'::jsonb
  );

update public.staff_training_status
set notes = 'Phase 1 shadow training: must be assigned on the same shift as any Phase 3 fully trained staff member. No designated mentor, same-mentor requirement, or mentor-history requirement applies.',
    updated_at = now()
where phase = 'phase_1_shadow_only'
  and coalesce(notes, '') in (
    'Must work with a fully trained employee. Initial trainee shifts may require the designated mentor.',
    'Phase 1 trainees must work with a fully trained employee and keep the same mentor for the first two shifts.',
    'Phase 1 shadow training requires the designated mentor for the first two shifts.'
  );

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
  v_role_rules jsonb := '[]'::jsonb;
  v_approved_exceptions jsonb := '[]'::jsonb;
  v_training_rules jsonb;
  v_budget_policy jsonb;
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

  v_training_rules := jsonb_build_object(
    'phase_1_assignment_type', 'shadow',
    'phase_1_counts_as_primary_coverage', false,
    'phase_1_requires_same_shift_phase_3', true,
    'qualified_trainer_phase', 'phase_3_fully_trained',
    'qualified_trainer_work_roles', to_jsonb(array['*']),
    'same_mentor_required', false,
    'mentor_history_required', false,
    'designated_initial_mentor_required', false,
    'initial_mentor_shift_count', 0
  );

  select jsonb_build_object(
    'configured_budget_eur', v_period.monthly_staff_budget_eur,
    'allow_overage_for_mandatory_coverage', coalesce(
      case
        when jsonb_typeof(ss.budget_policy) = 'object'
             and lower(coalesce(ss.budget_policy ->> 'allow_overage_for_mandatory_coverage', '')) in ('true', 'false')
          then (ss.budget_policy ->> 'allow_overage_for_mandatory_coverage')::boolean
        else null
      end,
      true
    ),
    'allow_overage_for_weekly_minimums', coalesce(
      case
        when jsonb_typeof(ss.budget_policy) = 'object'
             and lower(coalesce(ss.budget_policy ->> 'allow_overage_for_weekly_minimums', '')) in ('true', 'false')
          then (ss.budget_policy ->> 'allow_overage_for_weekly_minimums')::boolean
        else null
      end,
      true
    ),
    'allow_overage_for_required_training', coalesce(
      case
        when jsonb_typeof(ss.budget_policy) = 'object'
             and lower(coalesce(ss.budget_policy ->> 'allow_overage_for_required_training', '')) in ('true', 'false')
          then (ss.budget_policy ->> 'allow_overage_for_required_training')::boolean
        else null
      end,
      true
    ),
    'allow_overage_for_weekly_targets', coalesce(
      case
        when jsonb_typeof(ss.budget_policy) = 'object'
             and lower(coalesce(ss.budget_policy ->> 'allow_overage_for_weekly_targets', '')) in ('true', 'false')
          then (ss.budget_policy ->> 'allow_overage_for_weekly_targets')::boolean
        else null
      end,
      false
    ),
    'allow_overage_for_soft_quality', coalesce(
      case
        when jsonb_typeof(ss.budget_policy) = 'object'
             and lower(coalesce(ss.budget_policy ->> 'allow_overage_for_soft_quality', '')) in ('true', 'false')
          then (ss.budget_policy ->> 'allow_overage_for_soft_quality')::boolean
        else null
      end,
      false
    ),
    'minimize_required_overage', coalesce(
      case
        when jsonb_typeof(ss.budget_policy) = 'object'
             and lower(coalesce(ss.budget_policy ->> 'minimize_required_overage', '')) in ('true', 'false')
          then (ss.budget_policy ->> 'minimize_required_overage')::boolean
        else null
      end,
      true
    ),
    'overage_requires_manager_review', coalesce(
      case
        when jsonb_typeof(ss.budget_policy) = 'object'
             and lower(coalesce(ss.budget_policy ->> 'overage_requires_manager_review', '')) in ('true', 'false')
          then (ss.budget_policy ->> 'overage_requires_manager_review')::boolean
        else null
      end,
      true
    )
  )
    into v_budget_policy
  from public.scheduling_settings ss
  where ss.singleton is true
  order by ss.updated_at desc
  limit 1;

  v_budget_policy := coalesce(
    v_budget_policy,
    jsonb_build_object(
      'configured_budget_eur', v_period.monthly_staff_budget_eur,
      'allow_overage_for_mandatory_coverage', true,
      'allow_overage_for_weekly_minimums', true,
      'allow_overage_for_required_training', true,
      'allow_overage_for_weekly_targets', false,
      'allow_overage_for_soft_quality', false,
      'minimize_required_overage', true,
      'overage_requires_manager_review', true
    )
  );

  if to_regclass('public.role_scheduling_rules') is not null then
    execute $sql$
      with role_rule_rows as (
        select to_jsonb(rr) as raw_rule
        from public.role_scheduling_rules rr
      )
      select coalesce(
        jsonb_agg(
          jsonb_strip_nulls(
            jsonb_build_object(
              'id', raw_rule->'id',
              'name', raw_rule->'name',
              'scheduling_rule_role', coalesce(
                raw_rule->'scheduling_rule_role',
                raw_rule->'work_role'
              ),
              'work_role', raw_rule->'work_role',
              'is_active', to_jsonb(
                case
                  when raw_rule ? 'is_active'
                       and lower(coalesce(raw_rule->>'is_active', '')) in ('true', 'false')
                    then (raw_rule->>'is_active')::boolean
                  when raw_rule ? 'active'
                       and lower(coalesce(raw_rule->>'active', '')) in ('true', 'false')
                    then (raw_rule->>'active')::boolean
                  else true
                end
              ),
              'rule_config', coalesce(
                raw_rule->'rule_config',
                raw_rule->'config',
                raw_rule->'rules',
                '{}'::jsonb
              ),
              'raw', raw_rule
            )
          )
          order by
            coalesce(raw_rule->>'scheduling_rule_role', raw_rule->>'work_role', ''),
            coalesce(raw_rule->>'name', ''),
            coalesce(raw_rule->>'id', '')
        ),
        '[]'::jsonb
      )
      from role_rule_rows
      where case
        when raw_rule ? 'is_active'
             and lower(coalesce(raw_rule->>'is_active', '')) in ('true', 'false')
          then (raw_rule->>'is_active')::boolean
        when raw_rule ? 'active'
             and lower(coalesce(raw_rule->>'active', '')) in ('true', 'false')
          then (raw_rule->>'active')::boolean
        else true
      end
    $sql$
    into v_role_rules;
  end if;

  if to_regclass('public.approved_exceptions') is not null then
    execute $sql$
      with approved_exception_rows as (
        select to_jsonb(exception_row) as raw_exception
        from public.approved_exceptions exception_row
        where case
          when to_jsonb(exception_row) ? 'approved'
               and lower(coalesce(to_jsonb(exception_row)->>'approved', '')) in ('true', 'false')
            then (to_jsonb(exception_row)->>'approved')::boolean
          else true
        end
      )
      select coalesce(
        jsonb_agg(
          raw_exception
          order by
            coalesce(raw_exception->>'rule_id', ''),
            coalesce(raw_exception->>'staff_id', ''),
            coalesce(raw_exception->>'shift_id', ''),
            coalesce(raw_exception->>'week_start', '')
        ),
        '[]'::jsonb
      )
      from approved_exception_rows
    $sql$
    into v_approved_exceptions;
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
        sts.opening_training_completed_on,
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
        ss.budget_policy,
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
        streak.streak_start as week_start,
        streak.streak_start,
        streak.streak_end,
        streak.streak_days,
        false as waive_minimum
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
      'context_version', 2,
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
              'opening_training_completed_on', rt.opening_training_completed_on,
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
      'training_rules', v_training_rules,
      'budget_policy', v_budget_policy,
      'preferences', '[]'::jsonb,
      'role_rules', v_role_rules,
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
              'budget_policy', settings.budget_policy,
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
              'week_start', streak.week_start,
              'streak_start', streak.streak_start,
              'streak_end', streak.streak_end,
              'streak_days', streak.streak_days,
              'waive_minimum', streak.waive_minimum
            )
            order by streak.streak_start, streak.staff_id, streak.streak_end
          )
          from relevant_streaks streak
        ),
        '[]'::jsonb
      ),
      'approved_exceptions', v_approved_exceptions,
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
              coalesce(budget.staff_id::text, ''),
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
        'training_rule_source', 'planning_context.training_rules',
        'budget_policy_source', 'planning_context.budget_policy',
        'legacy_initial_mentor_setting_ignored', true,
        'active_role_rule_count', jsonb_array_length(v_role_rules),
        'configured_period_budget_eur', v_period.monthly_staff_budget_eur,
        'optional_shift_count', (select count(*) from relevant_shifts where is_optional is true),
        'mandatory_shift_count', (select count(*) from relevant_shifts where is_optional is false),
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
  'Canonical read-only planning input contract for one schedule period. Context version 2 adds normalized training_rules, budget_policy, dynamic role_rules, and deprecates legacy mentor requirements.';

revoke all on function public.get_schedule_planning_context(uuid) from public;
grant execute on function public.get_schedule_planning_context(uuid) to authenticated;
