begin;
create or replace function public.edit_schedule_day_shift(p_period_id uuid,p_action text,p_date date default null,p_shift_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$ declare p public.schedule_periods%rowtype; s public.shifts%rowtype; begin
 perform public.schedule_require_manager(); perform pg_advisory_xact_lock(87124001);
 select * into p from public.schedule_periods where id=p_period_id for update;
 if p.id is null then raise exception 'Schedule period not found.' using errcode='P0002'; end if;
 if p.status in ('published','locked') then raise exception 'Published or locked schedules cannot be edited.'; end if;
 if p_action='create' then
 if p_date is null or p_date not between p.start_date and p.end_date then raise exception 'Date is outside this schedule period.'; end if;
 if not exists(select 1 from public.shifts where period_id=p_period_id and shift_date=p_date and shift_type='day') then
 insert into public.shifts(period_id,shift_date,shift_type,is_optional,required_count) values(p_period_id,p_date,'day',true,1); end if;
 elsif p_action='delete' then
 select * into s from public.shifts where id=p_shift_id and period_id=p_period_id and shift_type='day';
 if s.id is null then raise exception 'Optional day shift not found.' using errcode='P0002'; end if;
 if exists(select 1 from public.shift_assignments where shift_id=s.id and status='assigned') then raise exception 'Remove assignments before removing this day shift.'; end if;
 delete from public.shifts where id=s.id;
 else raise exception 'Invalid day-shift action.'; end if;
 update public.schedule_periods set validated_availability_revision=-1 where id=p_period_id;
 insert into public.schedule_audit_events(period_id,actor_id,event,details) values(p_period_id,auth.uid(),'day_shift_'||p_action,jsonb_build_object('shift_id',p_shift_id,'date',p_date));
end $$;

update public.schedule_runtime_policy set engine_version='0.9.0' where singleton;
commit;
