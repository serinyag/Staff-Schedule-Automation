begin;
do $$
declare actor uuid; pid uuid; sid uuid;
begin
 select id into actor from public.profiles where app_role='admin' and is_active limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into pid from public.schedule_periods where status='drafting' limit 1;
 -- Legacy day rows used is_optional=false despite being optional in the UI.
 insert into public.shifts(period_id,shift_date,shift_type,is_optional,required_count)
 select pid,start_date,'day',false,1 from public.schedule_periods where id=pid returning id into sid;
 perform public.edit_schedule_day_shift(pid,'delete',null,sid);
 if exists(select 1 from public.shifts where id=sid) then raise exception 'Legacy empty day shift was not removed'; end if;
 if not exists(select 1 from public.schedule_audit_events where period_id=pid and event='day_shift_delete' and details->>'shift_id'=sid::text) then raise exception 'Deletion was not audited'; end if;
end $$;
rollback;
