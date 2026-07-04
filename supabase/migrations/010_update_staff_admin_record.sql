create or replace function public.update_staff_admin_record(
  p_staff_id uuid,
  p_work_role public.work_role,
  p_scheduling_rule_role public.work_role,
  p_hourly_rate numeric,
  p_is_active boolean,
  p_min_shifts_per_week numeric,
  p_target_shifts_per_week numeric,
  p_max_shifts_per_week numeric,
  p_training_phase public.training_phase default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_active_contract_id uuid;
  v_current_phase public.training_phase;
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
    return;
  end if;

  select sts.phase
    into v_current_phase
  from public.staff_training_status sts
  where sts.staff_id = p_staff_id;

  if v_current_phase is null then
    raise exception 'No training status row was found for this staff member.'
      using errcode = 'P0001';
  end if;

  if v_current_phase is distinct from p_training_phase then
    update public.staff_training_status
    set phase = p_training_phase,
        updated_by = (select auth.uid())
    where staff_id = p_staff_id;
  end if;
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
  public.training_phase
) to authenticated;
