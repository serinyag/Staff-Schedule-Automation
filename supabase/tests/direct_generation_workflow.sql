begin;
select set_config('request.jwt.claim.sub',(select s.profile_id::text from public.staff_members s join public.profiles p on p.id=s.profile_id where s.is_active and p.is_active and p.app_role='admin' limit 1),true);
set local role authenticated;
do $$
declare pid uuid; sid uuid; rid uuid; shiftid uuid; payload jsonb; count_before integer;
begin
 pid:=public.ensure_monthly_schedule_period();
 select id into sid from public.staff_members where profile_id=auth.uid();
 update public.schedule_periods set status='drafting' where id=pid;
 insert into public.schedule_generation_runs(period_id,status,initiated_by,metadata) values(pid,'planning',auth.uid(),jsonb_build_object('availability_revision',(select availability_revision from public.schedule_periods where id=pid))) returning id into rid;
 select id into shiftid from public.shifts where period_id=pid and shift_type='morning' order by shift_date limit 1;
 payload:=jsonb_build_array(jsonb_build_object('shift_id',shiftid,'staff_id',sid,'assignment_kind','coverage'));
 perform public.save_draft_assignments(rid,pid,payload);
 if not exists(select 1 from public.shift_assignments where generation_run_id=rid and lifecycle='draft' and assignment_kind='coverage') then raise exception 'Draft did not save'; end if;
 select count(*) into count_before from public.shift_assignments where generation_run_id=rid;
 update public.schedule_periods set availability_revision=availability_revision+1 where id=pid;
 begin
 perform public.save_draft_assignments(rid,pid,'[]');
 raise exception 'Stale solver result accepted';
 exception when sqlstate 'P0001' then
 if sqlerrm='Stale solver result accepted' then raise; end if;
 end;
 if (select count(*) from public.shift_assignments where generation_run_id=rid)<>count_before then raise exception 'Stale result changed saved draft'; end if;
end $$;
rollback;
select 'PASS: authenticated direct draft save and stale solver protection (rolled back)' result;
