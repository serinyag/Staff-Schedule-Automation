begin;
-- Wildcards are manual cover; they do not block monthly submissions or enter automatic generation.
do $$declare source text;begin
 source:=pg_get_functiondef('public.queue_schedule_job(uuid,text,uuid)'::regprocedure);
 source:=replace(source,'sm.is_active and not exists','sm.is_active and not sm.is_wildcard_fill_in and not exists');
 execute source;
end $$;
create function public.assign_wildcard_cover(p_period_id uuid,p_shift_id uuid,p_staff_id uuid default null,p_hourly_rate numeric default null,p_independent boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype;p public.schedule_periods%rowtype;sid uuid:=p_staff_id;subid uuid;begin
 perform public.schedule_require_manager();perform pg_advisory_xact_lock(87124001);
 select * into p from public.schedule_periods where id=p_period_id for update;
 select * into s from public.shifts where id=p_shift_id and period_id=p_period_id;
 if p.id is null or s.id is null or p.status in ('published','locked') then raise exception 'Choose a shift in an editable draft.';end if;
 if sid is null then
  if not p_independent or p_hourly_rate is null or p_hourly_rate<0 or p_hourly_rate>1000 then raise exception 'Confirm independent coverage and enter an hourly rate.';end if;
  if exists(select 1 from public.staff_members where lower(trim(full_name))='patrick') then raise exception 'Patrick already exists. Refresh and use his staff card.';end if;
  insert into public.staff_members(full_name,work_role,scheduling_rule_role,hourly_rate,is_active,is_wildcard_fill_in,default_weekly_budget_shifts)
   values('Patrick','host','host',p_hourly_rate,true,true,0) returning id into sid;
  insert into public.employment_contracts(staff_id,start_date,min_shifts_per_week,target_shifts_per_week,max_shifts_per_week,notes)
   values(sid,p.start_date,0,0,7,'Manual wildcard cover. No regular weekly minimum or target.');
  insert into public.staff_training_status(staff_id,phase,opening_training_completed_on,fully_trained_on,updated_by,notes)
   values(sid,'phase_3_fully_trained',current_date,current_date,auth.uid(),'Independent opening and closing confirmed by manager during wildcard setup.');
 else
  if not exists(select 1 from public.staff_members where id=sid and is_active and is_wildcard_fill_in) then raise exception 'Choose an active wildcard staff member.';end if;
 end if;
 if exists(select 1 from public.shift_assignments where shift_id=s.id and staff_id=sid and status='assigned' and lifecycle='draft') then raise exception 'Already assigned to this shift.';end if;
 if (select count(distinct a.staff_id) from public.shift_assignments a join public.shifts d on d.id=a.shift_id where d.period_id=p_period_id and d.shift_date=s.shift_date and a.status='assigned' and a.lifecycle='draft')>=3
 and not exists(select 1 from public.shift_assignments a join public.shifts d on d.id=a.shift_id where d.period_id=p_period_id and d.shift_date=s.shift_date and a.staff_id=sid and a.status='assigned' and a.lifecycle='draft') then raise exception 'Three staff are already scheduled that day. Move a day-shift assignment first.';end if;
 if exists(select 1 from public.shift_assignments a join public.shifts d on d.id=a.shift_id where d.period_id=p_period_id and d.shift_date=s.shift_date and a.staff_id=sid and a.status='assigned' and a.lifecycle='draft') then raise exception 'This wildcard already works another shift that day.';end if;
 -- The manager confirms availability for this particular shift, not the whole month.
 insert into public.availability_submissions(period_id,staff_id,status,willing_to_work_above_target,max_extra_shifts_for_period,submitted_at,notes)
 values(p_period_id,sid,'submitted',true,31,now(),'Manager-confirmed manual wildcard shifts only.')
 on conflict(period_id,staff_id) do update set status='submitted',willing_to_work_above_target=true,max_extra_shifts_for_period=31 returning id into subid;
 insert into public.availability_days(submission_id,available_date,morning,day,evening)
 values(subid,s.shift_date,s.shift_type='morning',s.shift_type='day',s.shift_type='evening')
 on conflict(submission_id,available_date) do update set morning=availability_days.morning or excluded.morning,day=availability_days.day or excluded.day,evening=availability_days.evening or excluded.evening;
 perform public.edit_schedule_assignment(p_period_id,'assign',p_shift_id,sid,null);
 insert into public.schedule_audit_events(period_id,actor_id,event,details) values(p_period_id,auth.uid(),'wildcard_cover_confirmed',jsonb_build_object('staff_id',sid,'shift_id',p_shift_id));
 return sid;
end $$;
revoke execute on function public.assign_wildcard_cover(uuid,uuid,uuid,numeric,boolean) from public,anon;
grant execute on function public.assign_wildcard_cover(uuid,uuid,uuid,numeric,boolean) to authenticated;
update public.schedule_runtime_policy set engine_version='0.9.2' where singleton;
commit;
