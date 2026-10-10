begin;

-- Keep the existing RLS-aware snapshot and add fixed neighbouring assignments.
alter function public.get_schedule_planning_context(uuid) rename to get_schedule_planning_context_v2_base;
create function public.get_schedule_planning_context(p_period_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_context jsonb; v_start date; v_end date; v_days integer; v_boundary jsonb;
begin
 v_context := public.get_schedule_planning_context_v2_base(p_period_id);
 v_start := (v_context->'period'->>'start_date')::date;
 v_end := (v_context->'period'->>'end_date')::date;
 v_days := greatest(7,coalesce((v_context->'settings'->>'default_hard_max_consecutive_days')::integer,5));
 select coalesce(jsonb_agg(jsonb_build_object('staff_id',a.staff_id,'shift_date',s.shift_date,'shift_type',s.shift_type) order by s.shift_date,a.staff_id),'[]'::jsonb)
 into v_boundary from public.shift_assignments a join public.shifts s on s.id=a.shift_id
 join public.schedule_periods sp on sp.id=s.period_id
 where s.period_id<>p_period_id and s.shift_date between v_start-v_days and v_end+v_days
 and (s.shift_date<v_start or s.shift_date>v_end)
 and a.status='assigned'
 and a.lifecycle::text=case when sp.status in ('published','locked') then 'published' else 'draft' end;
 return v_context || jsonb_build_object('boundary_assignments',v_boundary);
end $$;
revoke all on function public.get_schedule_planning_context(uuid) from public,anon;
grant execute on function public.get_schedule_planning_context(uuid) to authenticated,service_role;

-- Persist only selected day proposals, together with their assignments. A failure
-- in the existing authorized writer rolls the entire transaction back.
create function public.save_generated_schedule_draft(
 p_generation_run_id uuid,p_period_id uuid,p_assignments jsonb,p_proposed_shifts jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_period public.schedule_periods%rowtype; v_proposal jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and app_role in ('admin','manager')) then
  raise exception 'Manager access required.' using errcode='42501';
 end if;
 select * into v_period from public.schedule_periods where id=p_period_id for update;
 if v_period.id is null or v_period.status<>'drafting' then raise exception 'Only an unpublished draft can be replaced.'; end if;
 if p_proposed_shifts is null or jsonb_typeof(p_proposed_shifts)<>'array' or jsonb_typeof(p_assignments) is distinct from 'array' then raise exception 'Invalid generated draft.'; end if;
 for v_proposal in select value from jsonb_array_elements(p_proposed_shifts) loop
  if v_proposal->>'shift_type' is distinct from 'day'
    or (v_proposal->>'period_id')::uuid is distinct from p_period_id
    or (v_proposal->>'is_optional')::boolean is distinct from true
    or (v_proposal->>'required_count')::integer is distinct from 1
    or (v_proposal->>'shift_date')::date is null
    or (v_proposal->>'shift_date')::date not between v_period.start_date and v_period.end_date
    or v_proposal->>'start_time' is not null or v_proposal->>'end_time' is not null
    or not exists(select 1 from jsonb_array_elements(p_assignments) a where a->>'shift_id'=v_proposal->>'id') then
   raise exception 'Invalid optional day-shift proposal.';
  end if;
  if exists(select 1 from public.shifts where period_id=p_period_id and shift_date=(v_proposal->>'shift_date')::date and shift_type='day' and id<>(v_proposal->>'id')::uuid) then
   raise exception 'Day shifts changed during generation. Please generate again.';
  end if;
  if exists(select 1 from public.shifts where id=(v_proposal->>'id')::uuid) then
   raise exception 'Proposed shift already exists. Please generate again.';
  end if;
  insert into public.shifts(id,period_id,shift_date,shift_type,is_optional,required_count,notes)
  values((v_proposal->>'id')::uuid,p_period_id,(v_proposal->>'shift_date')::date,'day',true,1,'Proposed by the scheduling engine to meet staffing requirements.');
 end loop;
 return public.save_draft_assignments(p_generation_run_id,p_period_id,p_assignments);
end $$;
revoke all on function public.save_generated_schedule_draft(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_generated_schedule_draft(uuid,uuid,jsonb,jsonb) to authenticated;
commit;
