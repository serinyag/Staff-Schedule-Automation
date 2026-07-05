do $$
begin
  create type public.schedule_generation_run_status as enum (
    'queued',
    'analyzing_availability',
    'planning',
    'fairness_review',
    'validating',
    'completed',
    'failed',
    'cancelled'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.schedule_assignment_lifecycle as enum (
    'draft',
    'published'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.schedule_generation_runs (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.schedule_periods(id) on delete cascade,
  status public.schedule_generation_run_status not null default 'queued',
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  failed_at timestamptz null,
  failure_message text null,
  current_stage text not null default 'queued',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedule_generation_runs_period_idx
  on public.schedule_generation_runs (period_id);

create index if not exists schedule_generation_runs_status_idx
  on public.schedule_generation_runs (status);

create index if not exists schedule_generation_runs_created_at_idx
  on public.schedule_generation_runs (created_at desc);

create unique index if not exists schedule_generation_runs_active_period_idx
  on public.schedule_generation_runs (period_id)
  where status in (
    'queued',
    'analyzing_availability',
    'planning',
    'fairness_review',
    'validating'
  );

alter table public.shift_assignments
  add column if not exists lifecycle public.schedule_assignment_lifecycle;

alter table public.shift_assignments
  add column if not exists generation_run_id uuid null references public.schedule_generation_runs(id) on delete set null;

update public.shift_assignments
set lifecycle = 'published'
where lifecycle is null;

alter table public.shift_assignments
  alter column lifecycle set default 'draft';

alter table public.shift_assignments
  alter column lifecycle set not null;

create index if not exists shift_assignments_lifecycle_idx
  on public.shift_assignments (lifecycle);

create index if not exists shift_assignments_generation_run_idx
  on public.shift_assignments (generation_run_id);

alter table public.schedule_generation_runs enable row level security;

drop policy if exists "schedule_generation_runs manager select" on public.schedule_generation_runs;
create policy "schedule_generation_runs manager select"
  on public.schedule_generation_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  );

drop policy if exists "schedule_generation_runs manager insert" on public.schedule_generation_runs;
create policy "schedule_generation_runs manager insert"
  on public.schedule_generation_runs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  );

drop policy if exists "schedule_generation_runs manager update" on public.schedule_generation_runs;
create policy "schedule_generation_runs manager update"
  on public.schedule_generation_runs
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  );

alter table public.shift_assignments enable row level security;

drop policy if exists "shift_assignments manager select" on public.shift_assignments;
create policy "shift_assignments manager select"
  on public.shift_assignments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  );

drop policy if exists "shift_assignments manager insert" on public.shift_assignments;
create policy "shift_assignments manager insert"
  on public.shift_assignments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  );

drop policy if exists "shift_assignments manager update" on public.shift_assignments;
create policy "shift_assignments manager update"
  on public.shift_assignments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  );

drop policy if exists "shift_assignments manager delete" on public.shift_assignments;
create policy "shift_assignments manager delete"
  on public.shift_assignments
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active is true
        and p.app_role in ('admin', 'manager')
    )
  );

drop policy if exists "shift_assignments staff published select" on public.shift_assignments;
create policy "shift_assignments staff published select"
  on public.shift_assignments
  for select
  to authenticated
  using (
    lifecycle = 'published'
    and status = 'assigned'
    and exists (
      select 1
      from public.staff_members sm
      where sm.id = shift_assignments.staff_id
        and sm.profile_id = auth.uid()
        and sm.is_active is true
    )
  );

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
  where sp.id = p_period_id;

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
    '{}'::jsonb,
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

create or replace function public.publish_schedule_period(
  p_period_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_period public.schedule_periods%rowtype;
  v_block_count integer;
  v_draft_assignment_count integer;
begin
  select p.*
    into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if v_profile.id is null
     or v_profile.is_active is distinct from true
     or v_profile.app_role not in ('admin', 'manager') then
    raise exception 'You do not have permission to publish schedules.'
      using errcode = '42501';
  end if;

  select sp.*
    into v_period
  from public.schedule_periods sp
  where sp.id = p_period_id;

  if v_period.id is null then
    raise exception 'The selected schedule period could not be found.'
      using errcode = 'P0002';
  end if;

  if v_period.status = 'locked' then
    raise exception 'Locked schedule periods cannot be published.'
      using errcode = 'P0001';
  end if;

  select count(*)
    into v_draft_assignment_count
  from public.shift_assignments sa
  join public.shifts s
    on s.id = sa.shift_id
  where s.period_id = p_period_id
    and sa.status = 'assigned'
    and sa.lifecycle = 'draft';

  if coalesce(v_draft_assignment_count, 0) = 0 then
    raise exception 'There is no draft schedule to publish for this period.'
      using errcode = 'P0001';
  end if;

  select count(*)
    into v_block_count
  from public.validate_schedule_period(p_period_id) issue
  where lower(coalesce(issue.severity::text, '')) = 'block';

  if coalesce(v_block_count, 0) > 0 then
    raise exception 'The draft cannot be published while blocking validation issues remain.'
      using errcode = 'P0001';
  end if;

  update public.shift_assignments sa
  set lifecycle = 'published',
      updated_at = now()
  from public.shifts s
  where s.id = sa.shift_id
    and s.period_id = p_period_id
    and sa.lifecycle = 'draft';

  update public.schedule_periods
  set status = 'published',
      published_at = now(),
      updated_at = now()
  where id = p_period_id;
end;
$$;

grant execute on function public.publish_schedule_period(uuid) to authenticated;
