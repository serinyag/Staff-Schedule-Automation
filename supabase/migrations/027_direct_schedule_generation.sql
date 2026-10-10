begin;
alter table public.availability_revisions alter column created_at set default clock_timestamp();
create or replace function public.queue_schedule_generation_run(
  p_period_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_period public.schedule_periods%rowtype;
  v_existing_run_id uuid;
  v_run_id uuid;
begin
  select p.*
    into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if v_profile.id is null
     or v_profile.is_active is distinct from true
     or v_profile.app_role not in ('admin', 'manager') then
    raise exception 'You do not have permission to queue schedule generation.'
      using errcode = '42501';
  end if;

  select sp.*
    into v_period
  from public.schedule_periods sp
  where sp.id = p_period_id for update;

  if v_period.id is null then
    raise exception 'The selected schedule period could not be found.'
      using errcode = 'P0002';
  end if;

  if v_period.status = 'locked' then
    raise exception 'Locked schedule periods cannot be regenerated.'
      using errcode = 'P0001';
  end if;

  if v_period.status = 'published' then
    raise exception 'Published schedule periods cannot queue a new draft generation run.'
      using errcode = 'P0001';
  end if;

  if exists(select 1 from public.staff_members sm where sm.is_active and not exists(
 select 1 from public.availability_submissions a where a.period_id=p_period_id and a.staff_id=sm.id and a.status='submitted')) then
 raise exception 'All active staff must submit availability before generation.'; end if;
 update public.schedule_generation_runs set status='failed',current_stage='failed',failed_at=now(),failure_message='Generation interrupted. Please try again.'
 where period_id=p_period_id and status in ('queued','analyzing_availability','planning','fairness_review','validating') and started_at<now()-interval '5 minutes';
  select sgr.id
    into v_existing_run_id
  from public.schedule_generation_runs sgr
  where sgr.period_id = p_period_id
    and sgr.status in (
      'queued',
      'analyzing_availability',
      'planning',
      'fairness_review',
      'validating'
    )
  order by sgr.created_at desc
  limit 1;

  if v_existing_run_id is not null then
    raise exception 'A schedule generation run is already active for this period.'
      using errcode = '23505';
  end if;

  insert into public.schedule_generation_runs (
    period_id,
    status,
    initiated_by,
    started_at,
    current_stage,
    metadata,
    created_at,
    updated_at
  )
  values (
    p_period_id,
    'queued',
    auth.uid(),
    now(),
    'queued',
    jsonb_build_object('availability_revision',v_period.availability_revision),
    now(),
    now()
  )
  returning id
    into v_run_id;

  update public.schedule_periods
  set status = case
        when status = 'collecting_availability' then 'drafting'
        else status
      end,
      updated_at = now()
  where id = p_period_id;

  return v_run_id;
end;
$$;

grant execute on function public.queue_schedule_generation_run(uuid) to authenticated;


alter table public.shift_assignments add column if not exists assignment_kind text not null default 'coverage';

-- Replace the legacy unauthenticated writer with an authorized atomic save.
create or replace function public.save_draft_assignments(p_generation_run_id uuid,p_period_id uuid,p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_period public.schedule_periods%rowtype; v_run public.schedule_generation_runs%rowtype;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and app_role in ('admin','manager')) then raise exception 'Manager access required.' using errcode='42501'; end if;
 select * into v_period from public.schedule_periods where id=p_period_id for update;
 select * into v_run from public.schedule_generation_runs where id=p_generation_run_id and period_id=p_period_id for update;
 if v_run.id is null or v_run.initiated_by<>auth.uid() or v_run.status not in ('queued','planning','validating') then raise exception 'Generation run is no longer active.'; end if;
 if v_period.status<>'drafting' then raise exception 'Only an unpublished draft can be replaced.'; end if;
 if (v_run.metadata->>'availability_revision')::bigint is distinct from v_period.availability_revision then raise exception 'Availability changed while generating. Create the schedule again.'; end if;
 if p_assignments is null or jsonb_typeof(p_assignments)<>'array' then raise exception 'Invalid assignments.'; end if;
 if exists(select 1 from jsonb_array_elements(p_assignments) x where not exists(select 1 from public.shifts where id=(x->>'shift_id')::uuid and period_id=p_period_id) or not exists(select 1 from public.staff_members where id=(x->>'staff_id')::uuid and is_active)) then raise exception 'Invalid shift or staff member in generated draft.'; end if;
 delete from public.shift_assignments a using public.shifts s where s.id=a.shift_id and s.period_id=p_period_id and a.lifecycle='draft';
 insert into public.shift_assignments(shift_id,staff_id,lifecycle,generation_run_id,assigned_by,manager_note,assignment_kind)
 select (x->>'shift_id')::uuid,(x->>'staff_id')::uuid,'draft',p_generation_run_id,auth.uid(),x->>'planning_reason',coalesce(x->>'assignment_kind','coverage') from jsonb_array_elements(p_assignments) x;
 -- Publication still requires an explicit manager validation of the new draft.
 update public.schedule_periods set validated_availability_revision=-1 where id=p_period_id;
 return jsonb_build_object('inserted_count',jsonb_array_length(p_assignments));
end $$;
revoke all on function public.save_draft_assignments(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_draft_assignments(uuid,uuid,jsonb) to authenticated;

commit;
