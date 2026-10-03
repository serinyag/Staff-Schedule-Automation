begin;
-- Monthly availability is versioned separately from the effective submission.
create table public.availability_revisions (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.schedule_periods(id),
  staff_id uuid not null references public.staff_members(id),
  kind text not null check (kind in ('draft','submitted','pending','approved','rejected','superseded')),
  daily_availability jsonb not null,
  willing_to_work_above_target boolean not null default false,
  max_extra_shifts_for_period numeric,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);
create index on public.availability_revisions(period_id,staff_id,created_at desc);
alter table public.availability_revisions enable row level security;
create policy "Read own revisions or manage team" on public.availability_revisions for select to authenticated using (
 exists(select 1 from public.staff_members s where s.id=staff_id and s.profile_id=auth.uid())
 or exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.app_role in ('admin','manager'))
);
grant select on public.availability_revisions to authenticated;
revoke insert,update,delete on public.availability_revisions from authenticated,anon;
alter table public.schedule_periods add column availability_revision bigint not null default 0;
alter table public.schedule_periods add column validated_availability_revision bigint not null default 0;

create or replace function public.ensure_monthly_schedule_period()
returns uuid language plpgsql security definer set search_path='' as $$
declare v_start date := (date_trunc('month',now() at time zone 'Europe/Amsterdam') + interval '1 month')::date;
v_id uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
 raise exception 'Sign in to open availability.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(740210);
 select id into v_id from public.schedule_periods where start_date=v_start and end_date=(v_start+interval '1 month - 1 day')::date limit 1;
 if v_id is null then
 insert into public.schedule_periods(name,start_date,end_date,status,availability_deadline,created_by)
 values(to_char(v_start,'FMMonth YYYY'),v_start,(v_start+interval '1 month - 1 day')::date,'collecting_availability',null,auth.uid()) returning id into v_id;
 end if;
 insert into public.shifts(period_id,shift_date,shift_type,required_count,is_optional)
 select v_id,d::date,t::public.shift_type,1,false
 from generate_series(v_start,(v_start+interval '1 month - 1 day')::date,interval '1 day') d
 cross join (values ('morning'),('evening')) types(t)
 where not exists(select 1 from public.shifts s where s.period_id=v_id and s.shift_date=d::date and s.shift_type=t::public.shift_type);
 return v_id;
end $$;
revoke all on function public.ensure_monthly_schedule_period() from public;
grant execute on function public.ensure_monthly_schedule_period() to authenticated;

create or replace function public.submit_staff_availability(
 p_period_id uuid, p_status public.availability_submission_status,
 p_willing_to_work_above_target boolean default false,
 p_max_extra_shifts_for_period numeric default null, p_daily_availability jsonb default '[]'
) returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_staff_id uuid; v_period public.schedule_periods%rowtype; v_submission_id uuid; v_revision_id uuid;
 v_row_count integer; v_distinct_dates integer; v_invalid_rows integer; v_out_of_range_rows integer; v_missing_dates integer;
 v_today date := (now() at time zone 'Europe/Amsterdam')::date;
begin
 select s.id into v_staff_id from public.staff_members s join public.profiles p on p.id=s.profile_id
 where p.id=auth.uid() and p.is_active and s.is_active;
 if v_staff_id is null then raise exception 'Your staff profile is not active.' using errcode='42501'; end if;
 select * into v_period from public.schedule_periods where id=p_period_id for update;
 if v_period.id is null then raise exception 'Period not found.' using errcode='P0002'; end if;
 if v_period.status='locked' or v_period.end_date<v_today or v_period.start_date>(date_trunc('month',v_today)+interval '1 month')::date then
 raise exception 'This month is not open for availability.' using errcode='P0001'; end if;
 if p_status is null or p_daily_availability is null or jsonb_typeof(p_daily_availability)<>'array' then
 raise exception 'Invalid availability payload.' using errcode='P0001'; end if;
 if p_max_extra_shifts_for_period<0 then raise exception 'Extra shifts cannot be negative.'; end if;
  with payload as (
    select *
    from jsonb_to_recordset(p_daily_availability) as x(
      available_date date,
      morning boolean,
      day boolean,
      evening boolean
    )
  ),
  stats as (
    select
      count(*)::integer as row_count,
      count(distinct available_date)::integer as distinct_dates,
      count(*) filter (
        where available_date is null
          or morning is null
          or day is null
          or evening is null
      )::integer as invalid_rows,
      count(*) filter (
        where available_date < v_period.start_date
          or available_date > v_period.end_date
      )::integer as out_of_range_rows
    from payload
  ),
  missing as (
    select count(*)::integer as missing_dates
    from generate_series(v_period.start_date, v_period.end_date, interval '1 day') as gs(day_value)
    left join payload p
      on p.available_date = gs.day_value::date
    where p.available_date is null
  )
  select
    stats.row_count,
    stats.distinct_dates,
    stats.invalid_rows,
    stats.out_of_range_rows,
    missing.missing_dates
  into
    v_row_count,
    v_distinct_dates,
    v_invalid_rows,
    v_out_of_range_rows,
    v_missing_dates
  from stats
  cross join missing;

  if v_invalid_rows > 0 then
    raise exception 'Daily availability payload contains invalid or incomplete rows.'
      using errcode = 'P0001';
  end if;

  if v_row_count <> v_distinct_dates then
    raise exception 'Daily availability payload contains duplicate dates.'
      using errcode = 'P0001';
  end if;

  if v_out_of_range_rows > 0 then
    raise exception 'Daily availability payload contains dates outside the selected schedule period.'
      using errcode = 'P0001';
  end if;

  if v_missing_dates > 0 then
    raise exception 'Daily availability payload must include every date in the selected schedule period.'
      using errcode = 'P0001';
  end if;


 -- Past days are immutable; first-time submissions keep their default availability.
 if exists(select 1 from jsonb_to_recordset(p_daily_availability) x(available_date date,morning boolean,day boolean,evening boolean)
 left join public.availability_submissions a on a.period_id=p_period_id and a.staff_id=v_staff_id
 left join public.availability_days d on d.submission_id=a.id and d.available_date=x.available_date
 where x.available_date<v_today and (x.morning is distinct from coalesce(d.morning,true) or x.day is distinct from coalesce(d.day,true) or x.evening is distinct from coalesce(d.evening,true))) then
 raise exception 'Past dates cannot be changed.' using errcode='P0001'; end if;
 if p_status='submitted' then
 update public.availability_revisions set kind='superseded' where period_id=p_period_id and staff_id=v_staff_id and kind='pending';
 end if;
 insert into public.availability_revisions(period_id,staff_id,kind,daily_availability,willing_to_work_above_target,max_extra_shifts_for_period,actor_id)
 values(p_period_id,v_staff_id,case when p_status='draft' then 'draft' when v_period.status='published' then 'pending' else 'submitted' end,p_daily_availability,p_willing_to_work_above_target,p_max_extra_shifts_for_period,auth.uid()) returning id into v_revision_id;
 -- Drafts and published-month requests never replace the effective submission.
 if p_status='draft' or v_period.status='published' then return v_revision_id; end if;
 insert into public.availability_submissions as a(period_id,staff_id,status,willing_to_work_above_target,max_extra_shifts_for_period,submitted_at)
 values(p_period_id,v_staff_id,'submitted',p_willing_to_work_above_target,p_max_extra_shifts_for_period,now())
 on conflict(period_id,staff_id) do update set status='submitted',willing_to_work_above_target=excluded.willing_to_work_above_target,max_extra_shifts_for_period=excluded.max_extra_shifts_for_period,submitted_at=now(),updated_at=now()
 returning id into v_submission_id;
 delete from public.availability_days where submission_id=v_submission_id;
 insert into public.availability_days(submission_id,available_date,morning,day,evening)
 select v_submission_id,x.* from jsonb_to_recordset(p_daily_availability) x(available_date date,morning boolean,day boolean,evening boolean);
 update public.schedule_periods set availability_revision=availability_revision+1 where id=p_period_id;
 return v_revision_id;
end $$;
-- All writes go through authenticated, atomic workflow functions.
revoke insert,update,delete on public.availability_submissions,public.availability_days from authenticated,anon;

create or replace function public.review_availability_request(p_request_id uuid,p_approve boolean,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare r public.availability_revisions%rowtype; v_id uuid; v_period uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and app_role in ('admin','manager')) then
 raise exception 'Manager access required.' using errcode='42501'; end if;
 select period_id into v_period from public.availability_revisions where id=p_request_id;
 perform 1 from public.schedule_periods where id=v_period for update;
 select * into r from public.availability_revisions where id=p_request_id for update;
 if r.id is null or r.kind<>'pending' then raise exception 'This request is no longer pending.'; end if;
 if p_approve then
 if exists(select 1 from public.schedule_periods where id=r.period_id and (status='locked' or end_date<(now() at time zone 'Europe/Amsterdam')::date)) then raise exception 'This month is closed.'; end if;
 -- Approval cannot silently invalidate an assigned published shift.
 if exists(select 1 from public.shift_assignments a join public.shifts s on s.id=a.shift_id
 join jsonb_to_recordset(r.daily_availability) x(available_date date,morning boolean,day boolean,evening boolean) on x.available_date=s.shift_date
 where s.period_id=r.period_id and a.staff_id=r.staff_id and a.status='assigned' and a.lifecycle='published'
 and not (case s.shift_type when 'morning' then x.morning when 'day' then x.day else x.evening end)) then
 raise exception 'This request conflicts with published shifts. Arrange cover before approving, or reject with a note.'; end if;
 insert into public.availability_submissions as a(period_id,staff_id,status,willing_to_work_above_target,max_extra_shifts_for_period,submitted_at)
 values(r.period_id,r.staff_id,'submitted',r.willing_to_work_above_target,r.max_extra_shifts_for_period,now())
 on conflict(period_id,staff_id) do update set status='submitted',willing_to_work_above_target=excluded.willing_to_work_above_target,max_extra_shifts_for_period=excluded.max_extra_shifts_for_period,submitted_at=now(),updated_at=now() returning id into v_id;
 insert into public.availability_days(submission_id,available_date,morning,day,evening)
 select v_id,x.* from jsonb_to_recordset(r.daily_availability) x(available_date date,morning boolean,day boolean,evening boolean)
 where x.available_date >= (now() at time zone 'Europe/Amsterdam')::date
 on conflict(submission_id,available_date) do update set morning=excluded.morning,day=excluded.day,evening=excluded.evening;
 update public.schedule_periods set availability_revision=availability_revision+1 where id=r.period_id;
 end if;
 update public.availability_revisions set kind=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_note where id=r.id;
end $$;
revoke all on function public.review_availability_request(uuid,boolean,text) from public;
grant execute on function public.review_availability_request(uuid,boolean,text) to authenticated;

create or replace function public.revalidate_availability_draft(p_period_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and app_role in ('admin','manager')) then raise exception 'Manager access required.' using errcode='42501'; end if;
 perform 1 from public.schedule_periods where id=p_period_id for update;
 if exists(select 1 from public.validate_schedule_period(p_period_id) i where lower(i.severity::text)='block') then raise exception 'Resolve the blocking schedule issues before revalidating.'; end if;
 update public.schedule_periods set validated_availability_revision=availability_revision where id=p_period_id;
end $$;
revoke all on function public.revalidate_availability_draft(uuid) from public;
grant execute on function public.revalidate_availability_draft(uuid) to authenticated;

create or replace function public.guard_schedule_publication()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='published' and old.status<>'published' and new.availability_revision<>new.validated_availability_revision then
 raise exception 'Availability changed. Revalidate this draft before publishing.'; end if;
 return new;
end $$;
create trigger availability_publication_guard before update on public.schedule_periods for each row execute function public.guard_schedule_publication();

create or replace function public.save_monthly_availability(p_period_id uuid,p_status public.availability_submission_status,p_daily_availability jsonb,p_expected_revision uuid default null,p_willing_to_work_above_target boolean default false,p_max_extra_shifts_for_period numeric default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_latest uuid;
begin
 perform 1 from public.schedule_periods where id=p_period_id for update;
 select r.id into v_latest from public.availability_revisions r join public.staff_members s on s.id=r.staff_id where r.period_id=p_period_id and s.profile_id=auth.uid() order by r.created_at desc,r.id desc limit 1;
 if v_latest is distinct from p_expected_revision then raise exception 'Your availability changed in another session. Refresh before saving.' using errcode='P0001'; end if;
 return public.submit_staff_availability(p_period_id,p_status,p_willing_to_work_above_target,p_max_extra_shifts_for_period,p_daily_availability);
end $$;
revoke all on function public.save_monthly_availability(uuid,public.availability_submission_status,jsonb,uuid,boolean,numeric) from public;
grant execute on function public.save_monthly_availability(uuid,public.availability_submission_status,jsonb,uuid,boolean,numeric) to authenticated;
revoke execute on function public.submit_staff_availability(uuid,public.availability_submission_status,boolean,numeric,jsonb) from authenticated,anon,public;
commit;
