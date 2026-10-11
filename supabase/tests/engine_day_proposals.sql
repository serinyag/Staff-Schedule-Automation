begin;
select set_config('request.jwt.claim.sub',(select s.profile_id::text from public.staff_members s join public.profiles p on p.id=s.profile_id where s.is_active and p.is_active and p.app_role='admin' limit 1),true);
set local role authenticated;
do $$
declare pid uuid; sid uuid; rid uuid; shiftid uuid:=gen_random_uuid(); payload jsonb; proposals jsonb; d date; context jsonb;
begin
 pid:=public.ensure_monthly_schedule_period();
 select id into sid from public.staff_members where profile_id=auth.uid();
 update public.schedule_periods set status='drafting' where id=pid;
 select min(day::date) into d from public.schedule_periods sp cross join lateral generate_series(sp.start_date,sp.end_date,interval '1 day') day where sp.id=pid and not exists(select 1 from public.shifts s where s.period_id=pid and s.shift_date=day::date and s.shift_type='day');
 if d is null then raise exception 'No unused test date'; end if;
 insert into public.schedule_generation_runs(period_id,status,initiated_by,metadata) values(pid,'planning',auth.uid(),jsonb_build_object('availability_revision',(select availability_revision from public.schedule_periods where id=pid))) returning id into rid;
 payload:=jsonb_build_array(jsonb_build_object('shift_id',shiftid,'staff_id',sid,'assignment_kind','coverage'));
 proposals:=jsonb_build_array(jsonb_build_object('id',shiftid,'period_id',pid,'shift_date',d,'shift_type','day','is_optional',true,'required_count',1));
 perform public.save_generated_schedule_draft(rid,pid,payload,proposals);
 if not exists(select 1 from public.shifts where id=shiftid and shift_type='day' and is_optional) then raise exception 'Day proposal not saved'; end if;
 if not exists(select 1 from public.shift_assignments where shift_id=shiftid and staff_id=sid and lifecycle='draft') then raise exception 'Assignment not saved'; end if;
 context:=public.get_schedule_planning_context(pid);
 if jsonb_typeof(context->'boundary_assignments') is distinct from 'array' then raise exception 'Missing boundary snapshot'; end if;
 update public.schedule_periods set availability_revision=availability_revision+1 where id=pid;
 shiftid:=gen_random_uuid(); d:=d+1;
 while exists(select 1 from public.shifts where period_id=pid and shift_date=d and shift_type='day') loop d:=d+1; end loop;
 payload:=jsonb_build_array(jsonb_build_object('shift_id',shiftid,'staff_id',sid,'assignment_kind','coverage'));
 proposals:=jsonb_build_array(jsonb_build_object('id',shiftid,'period_id',pid,'shift_date',d,'shift_type','day','is_optional',true,'required_count',1));
 begin
  perform public.save_generated_schedule_draft(rid,pid,payload,proposals);
  raise exception 'Stale proposal accepted';
 exception when sqlstate 'P0001' then
  if sqlerrm='Stale proposal accepted' or sqlerrm not like 'Availability changed%' then raise; end if;
 end;
 if exists(select 1 from public.shifts where id=shiftid) then raise exception 'Stale proposal was not rolled back'; end if;
end $$;
rollback;
select 'PASS: selected day proposal + draft saved atomically; stale proposal rolled back; boundary snapshot present. All test data rolled back.' as result;
