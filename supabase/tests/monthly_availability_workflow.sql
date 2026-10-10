begin;
select set_config('request.jwt.claim.sub',(select s.profile_id::text from public.staff_members s join public.profiles p on p.id=s.profile_id where s.is_active and p.is_active and p.app_role='admin' limit 1),true);
set local role authenticated;
do $$
declare pid uuid; sid uuid; rev uuid; draft uuid; request uuid; days jsonb; changed jsonb; effective_id uuid;
begin
 pid:=public.ensure_monthly_schedule_period();
 if pid is distinct from public.ensure_monthly_schedule_period() then raise exception 'period creation not idempotent'; end if;
 select id into sid from public.staff_members where profile_id=auth.uid();
 select jsonb_agg(jsonb_build_object('available_date',d::date,'morning',true,'day',true,'evening',true)) into days from public.schedule_periods p cross join lateral generate_series(p.start_date,p.end_date,interval '1 day') d where p.id=pid;
 select id into rev from public.availability_revisions where period_id=pid and staff_id=sid order by created_at desc,id desc limit 1;
 rev:=public.save_monthly_availability(pid,'submitted',days,rev);
 select id into effective_id from public.availability_submissions where period_id=pid and staff_id=sid;
 changed:=jsonb_set(days,'{0,morning}','false');
 draft:=public.save_monthly_availability(pid,'draft',changed,rev);
 if not (select morning from public.availability_days where submission_id=effective_id order by available_date limit 1) then raise exception 'draft overwrote effective submission'; end if;
 if (select status from public.availability_submissions where id=effective_id)<>'submitted' then raise exception 'draft downgraded submitted status'; end if;
 begin
 perform public.save_monthly_availability(pid,'submitted',changed,rev);
 raise exception 'stale revision accepted';
 exception when sqlstate 'P0001' then
 if sqlerrm='stale revision accepted' then raise; end if;
 end;
 rev:=public.save_monthly_availability(pid,'submitted',changed,draft);
 if (select morning from public.availability_days where submission_id=effective_id order by available_date limit 1) then raise exception 'saved update not effective'; end if;
 begin
 update public.schedule_periods set status='published' where id=pid;
 raise exception 'stale publication accepted';
 exception when sqlstate 'P0001' then
 if sqlerrm='stale publication accepted' then raise; end if;
 end;
 update public.schedule_periods set validated_availability_revision=availability_revision,status='published' where id=pid;
 request:=public.save_monthly_availability(pid,'submitted',days,rev);
 if (select kind from public.availability_revisions where id=request)<>'pending' then raise exception 'published update did not request review'; end if;
 if (select morning from public.availability_days where submission_id=effective_id order by available_date limit 1) then raise exception 'pending request overwrote effective availability'; end if;
 perform public.review_availability_request(request,false,'Regression test');
 if (select kind from public.availability_revisions where id=request)<>'rejected' then raise exception 'review not persisted'; end if;
 request:=public.save_monthly_availability(pid,'submitted',days,request);
 perform public.review_availability_request(request,true,'Approved regression test');
 if not (select morning from public.availability_days where submission_id=effective_id order by available_date limit 1) then raise exception 'approved request did not update effective availability'; end if;
 begin
 insert into public.availability_revisions(period_id,staff_id,kind,daily_availability,actor_id) values(pid,sid,'submitted',days,auth.uid());
 raise exception 'direct history mutation allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
select 'PASS: authenticated RLS, approval, rejection, drafts, stale edits, monthly opening and publication guard (rolled back)' result;
