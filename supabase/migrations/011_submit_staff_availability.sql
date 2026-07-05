create or replace function public.submit_staff_availability(
  p_period_id uuid,
  p_status public.availability_submission_status,
  p_willing_to_work_above_target boolean default false,
  p_max_extra_shifts_for_period numeric default null,
  p_daily_availability jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_period public.schedule_periods%rowtype;
  v_submission_id uuid;
  v_row_count integer;
  v_distinct_dates integer;
  v_invalid_rows integer;
  v_out_of_range_rows integer;
  v_missing_dates integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to submit availability.'
      using errcode = '42501';
  end if;

  if p_daily_availability is null or jsonb_typeof(p_daily_availability) <> 'array' then
    raise exception 'Daily availability payload must be a JSON array.'
      using errcode = 'P0001';
  end if;

  select sm.id
    into v_staff_id
  from public.staff_members sm
  where sm.profile_id = auth.uid()
    and sm.is_active is true
  limit 1;

  if v_staff_id is null then
    raise exception 'Your staff record is not active for availability submissions.'
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

  if v_period.status not in ('collecting_availability', 'drafting') then
    raise exception 'This schedule period is no longer accepting availability updates.'
      using errcode = 'P0001';
  end if;

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

  insert into public.availability_submissions as submission (
    period_id,
    staff_id,
    status,
    willing_to_work_above_target,
    max_extra_shifts_for_period,
    submitted_at
  )
  values (
    p_period_id,
    v_staff_id,
    p_status,
    p_willing_to_work_above_target,
    p_max_extra_shifts_for_period,
    case when p_status = 'submitted' then now() else null end
  )
  on conflict (period_id, staff_id) do update
  set status = excluded.status,
      willing_to_work_above_target = excluded.willing_to_work_above_target,
      max_extra_shifts_for_period = excluded.max_extra_shifts_for_period,
      submitted_at = case
        when excluded.status = 'submitted' then now()
        else submission.submitted_at
      end
  returning submission.id
    into v_submission_id;

  delete from public.availability_days
  where submission_id = v_submission_id;

  insert into public.availability_days (
    submission_id,
    available_date,
    morning,
    day,
    evening
  )
  select
    v_submission_id,
    payload.available_date,
    payload.morning,
    payload.day,
    payload.evening
  from jsonb_to_recordset(p_daily_availability) as payload(
    available_date date,
    morning boolean,
    day boolean,
    evening boolean
  );

  return v_submission_id;
end;
$$;

revoke all on function public.submit_staff_availability(
  uuid,
  public.availability_submission_status,
  boolean,
  numeric,
  jsonb
) from public;

grant execute on function public.submit_staff_availability(
  uuid,
  public.availability_submission_status,
  boolean,
  numeric,
  jsonb
) to authenticated;
