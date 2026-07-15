alter table public.staff_training_status
add column if not exists opening_training_completed_on date null;

update public.staff_training_status
set opening_training_completed_on = phase_started_on
where opening_training_completed_on is null
  and phase in ('phase_2_opening_independent', 'phase_3_fully_trained');

drop function if exists public.update_staff_admin_record(
  uuid,
  public.work_role,
  public.work_role,
  numeric,
  boolean,
  numeric,
  numeric,
  numeric,
  public.training_phase
);

create or replace function public.update_staff_admin_record(
  p_staff_id uuid,
  p_work_role public.work_role,
  p_scheduling_rule_role public.work_role,
  p_hourly_rate numeric,
  p_is_active boolean,
  p_min_shifts_per_week numeric,
  p_target_shifts_per_week numeric,
  p_max_shifts_per_week numeric,
  p_training_phase public.training_phase default null,
  p_opening_training_completed boolean default null,
  p_opening_training_completed_on date default null,
  p_closing_training_completed boolean default null,
  p_closing_training_completed_on date default null,
  p_training_note text default null
)
returns public.staff_training_status
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_active_contract_id uuid;
  v_training_row public.staff_training_status%rowtype;
  v_requested_opening_completed boolean;
  v_requested_closing_completed boolean;
  v_resolved_opening_completed_on date;
  v_resolved_closing_completed_on date;
  v_resolved_phase_started_on date;
  v_resolved_note text;
begin
  select p.*
    into v_profile
  from public.profiles p
  where p.id = (select auth.uid());

  if v_profile.id is null
     or v_profile.is_active is distinct from true
     or v_profile.app_role not in ('admin', 'manager') then
    raise exception 'You do not have permission to update staff records.'
      using errcode = '42501';
  end if;

  update public.staff_members
  set work_role = p_work_role,
      scheduling_rule_role = p_scheduling_rule_role,
      hourly_rate = p_hourly_rate,
      is_active = p_is_active
  where id = p_staff_id;

  if not found then
    raise exception 'Staff member not found.'
      using errcode = 'P0002';
  end if;

  select ec.id
    into v_active_contract_id
  from public.employment_contracts ec
  where ec.staff_id = p_staff_id
    and ec.start_date <= current_date
    and (ec.end_date is null or ec.end_date >= current_date)
  order by ec.start_date desc
  limit 1;

  if v_active_contract_id is null then
    raise exception 'No active employment contract was found for this staff member.'
      using errcode = 'P0001';
  end if;

  update public.employment_contracts
  set min_shifts_per_week = p_min_shifts_per_week,
      target_shifts_per_week = p_target_shifts_per_week,
      max_shifts_per_week = p_max_shifts_per_week
  where id = v_active_contract_id;

  if p_training_phase is null then
    return null;
  end if;

  select sts.*
    into v_training_row
  from public.staff_training_status sts
  where sts.staff_id = p_staff_id
  for update;

  if v_training_row.staff_id is null then
    raise exception 'No training status row was found for this staff member.'
      using errcode = 'P0001';
  end if;

  v_requested_opening_completed := coalesce(
    p_opening_training_completed,
    v_training_row.opening_training_completed_on is not null
  );
  v_requested_closing_completed := coalesce(
    p_closing_training_completed,
    v_training_row.fully_trained_on is not null
  );

  v_resolved_opening_completed_on := case
    when v_requested_opening_completed then coalesce(
      p_opening_training_completed_on,
      v_training_row.opening_training_completed_on,
      current_date
    )
    else null
  end;

  v_resolved_closing_completed_on := case
    when v_requested_closing_completed then coalesce(
      p_closing_training_completed_on,
      v_training_row.fully_trained_on,
      current_date
    )
    else null
  end;

  if p_training_phase = 'phase_2_opening_independent'
     and v_resolved_opening_completed_on is null then
    raise exception 'Opening training completion is required for Phase 2.'
      using errcode = 'P0001';
  end if;

  if p_training_phase = 'phase_3_fully_trained'
     and v_resolved_opening_completed_on is null then
    raise exception 'Opening training completion is required for Phase 3.'
      using errcode = 'P0001';
  end if;

  if p_training_phase = 'phase_3_fully_trained'
     and v_resolved_closing_completed_on is null then
    raise exception 'Closing training completion is required for Phase 3.'
      using errcode = 'P0001';
  end if;

  v_resolved_phase_started_on := case p_training_phase
    when 'phase_1_shadow_only' then coalesce(
      v_training_row.training_started_on,
      v_training_row.phase_started_on,
      current_date
    )
    when 'phase_2_opening_independent' then coalesce(
      v_resolved_opening_completed_on,
      v_training_row.phase_started_on,
      current_date
    )
    when 'phase_3_fully_trained' then coalesce(
      v_resolved_closing_completed_on,
      v_training_row.phase_started_on,
      current_date
    )
    else coalesce(v_training_row.phase_started_on, current_date)
  end;

  v_resolved_note := coalesce(nullif(trim(p_training_note), ''), v_training_row.notes);

  update public.staff_training_status
  set phase = p_training_phase,
      phase_started_on = v_resolved_phase_started_on,
      opening_training_completed_on = v_resolved_opening_completed_on,
      fully_trained_on = v_resolved_closing_completed_on,
      updated_by = (select auth.uid()),
      notes = v_resolved_note,
      updated_at = now()
  where staff_id = p_staff_id
  returning * into v_training_row;

  return v_training_row;
end;
$$;

grant execute on function public.update_staff_admin_record(
  uuid,
  public.work_role,
  public.work_role,
  numeric,
  boolean,
  numeric,
  numeric,
  numeric,
  public.training_phase,
  boolean,
  date,
  boolean,
  date,
  text
) to authenticated;
