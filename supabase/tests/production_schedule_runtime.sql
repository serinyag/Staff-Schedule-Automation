-- Run against a migrated database; every fixture/change is rolled back.
begin;
do $$
declare actor uuid; pid uuid; other_pid uuid; sid uuid; shiftid uuid; sourceid uuid; rid uuid; token uuid; ctx jsonb; baseline jsonb; result jsonb; claimed jsonb; validation jsonb; snapshot jsonb; before_rows jsonb;
begin
 select id into actor from public.profiles where is_active and app_role='admin' limit 1;
 if actor is null then raise exception 'Runtime tests need an existing administrator.'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select id into pid from public.schedule_periods where status='drafting' order by created_at limit 1;
 if pid is null then raise exception 'Runtime tests need an unpublished draft period.'; end if;
 select id into other_pid from public.schedule_periods where id<>pid and status not in ('published','locked') limit 1;
 select id into shiftid from public.shifts where period_id=pid order by shift_date limit 1;
 select a.id,a.staff_id into sourceid,sid from public.shift_assignments a join public.shifts s on s.id=a.shift_id where s.period_id=pid and a.lifecycle='draft' and a.status='assigned' limit 1;
 before_rows:=public.schedule_draft_rows(pid);
 -- A period ID cannot authorize an assignment from another period.
 if other_pid is not null and sourceid is not null then
 begin
 perform public.edit_schedule_assignment(other_pid,'remove',null,null,sourceid);
 raise exception 'Cross-period removal was accepted';
 exception when sqlstate 'P0001' or sqlstate 'P0002' then
 if sqlerrm='Cross-period removal was accepted' then raise; end if;
 end;
 end if;
 if public.schedule_draft_rows(pid)<>before_rows then raise exception 'Rejected edit changed assignments'; end if;
 -- Clients cannot reach trusted-only RPCs or write run/validation/assignment tables.
 if has_function_privilege('authenticated','public.finish_schedule_job(uuid,uuid,jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.record_schedule_validation(uuid,uuid,text,text,text,jsonb,boolean)','EXECUTE')
 or has_function_privilege('anon','public.queue_schedule_job(uuid,text,uuid)','EXECUTE')
 or has_table_privilege('authenticated','public.schedule_generation_runs','UPDATE')
 or has_table_privilege('authenticated','public.shift_assignments','UPDATE')
 or has_table_privilege('authenticated','public.schedule_validation_checks','INSERT') then raise exception 'Excessive runtime privileges'; end if;
 begin perform public.publish_schedule_period(pid); raise exception 'Unchecked publication accepted';
 exception when sqlstate 'P0001' then if sqlerrm='Unchecked publication accepted' then raise; end if; end;
 -- Isolate test leases without deleting any real run history.
 update public.schedule_generation_runs set status='cancelled' where period_id=pid and status in ('queued','planning','validating','analyzing_availability','fairness_review');
 ctx:=public.schedule_snapshot_context(pid); baseline:=public.schedule_draft_rows(pid);
 insert into public.schedule_generation_runs(period_id,initiated_by,input_snapshot,input_hash,baseline_hash,metadata)
 values(pid,actor,jsonb_build_object('context',ctx,'baseline',baseline),public.schedule_json_hash(ctx),public.schedule_json_hash(baseline),
 jsonb_build_object('availability_revision',(select availability_revision from public.schedule_periods where id=pid))) returning id into rid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
 claimed:=public.claim_schedule_job(rid); token:=(claimed->>'lease_token')::uuid;
 if claimed->>'state'<>'claimed' or public.claim_schedule_job(rid)->>'state'<>'busy' then raise exception 'Lease exclusivity failed'; end if;
 result:=jsonb_build_object('engine_version','0.8.0','generation_status','generated','draft_assignments',(select coalesce(jsonb_agg(a||jsonb_build_object('planning_reason',a->>'manager_note')),'[]') from jsonb_array_elements(baseline) a),
 'proposed_shifts','[]'::jsonb,'validation',jsonb_build_object('ready_for_commit',false,'errors','[]'::jsonb,'warnings','[]'::jsonb,'review_items','[]'::jsonb));
 -- A concurrent manual edit must stop completion without touching that edit.
 if sourceid is not null then update public.shift_assignments set status='cancelled' where id=sourceid; end if;
 begin perform public.finish_schedule_job(rid,token,result); raise exception 'Stale completion accepted';
 exception when sqlstate 'P0001' then if sqlerrm='Stale completion accepted' then raise; end if; end;
 if sourceid is not null then update public.shift_assignments set status='assigned' where id=sourceid; end if;
 -- Invalid proposals roll back all replacement and completion writes.
 result:=jsonb_set(result,'{proposed_shifts}',jsonb_build_array(jsonb_build_object('shift_type','morning')));
 begin perform public.finish_schedule_job(rid,token,result); raise exception 'Invalid proposal accepted';
 exception when others then if sqlerrm='Invalid proposal accepted' then raise; end if; end;
 if (select status from public.schedule_generation_runs where id=rid)<>'planning' or public.schedule_draft_rows(pid)<>baseline then raise exception 'Failed completion partially committed'; end if;
 result:=jsonb_set(result,'{proposed_shifts}','[]');
 perform public.finish_schedule_job(rid,token,result);
 if (select status from public.schedule_generation_runs where id=rid)<>'completed' or public.schedule_draft_rows(pid)<>baseline then raise exception 'Atomic completion failed'; end if;
 if public.claim_schedule_job(rid)->>'state'<>'done' then raise exception 'Completed job replayed'; end if;
 -- Attestations are bound to inputs, assignments and engine version.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 snapshot:=public.schedule_review_snapshot(pid);
 validation:=jsonb_build_object('engine_version','0.8.0','ready_for_commit',false,'errors',jsonb_build_array(jsonb_build_object('code','manager_consecutive_days_off_missing','severity','error','message','Two consecutive days off needed.')),'warnings','[]');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
 perform public.record_schedule_validation(pid,actor,snapshot->>'input_hash',snapshot->>'draft_hash','0.8.0',validation,false);
 if not exists(select 1 from public.validate_schedule_period(pid) where code='manager_consecutive_days_off_missing') then raise exception 'Canonical issues missing'; end if;
 begin perform public.publish_schedule_period(pid); raise exception 'Blocking validation was published';
 exception when sqlstate 'P0001' then if sqlerrm='Blocking validation was published' then raise; end if; end;
 update public.schedule_periods set monthly_staff_budget_eur=coalesce(monthly_staff_budget_eur,0)+1 where id=pid;
 if public.schedule_current_validation(pid) is not null then raise exception 'Changed inputs retained validation'; end if;
 begin perform public.record_schedule_validation(pid,actor,snapshot->>'input_hash',snapshot->>'draft_hash','0.8.0',validation,false); raise exception 'Stale attestation accepted';
 exception when sqlstate 'P0001' then if sqlerrm='Stale attestation accepted' then raise; end if; end;
 -- A new, successful check publishes exactly that checked draft atomically.
 snapshot:=public.schedule_review_snapshot(pid);
 validation:=jsonb_build_object('engine_version','0.8.0','ready_for_commit',true,'errors','[]'::jsonb,'warnings','[]'::jsonb);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
 perform public.record_schedule_validation(pid,actor,snapshot->>'input_hash',snapshot->>'draft_hash','0.8.0',validation,true);
 if (select status from public.schedule_periods where id=pid)<>'published' or jsonb_array_length(public.schedule_draft_rows(pid))<>0 then raise exception 'Atomic publication failed'; end if;
 begin update public.schedule_periods set status='drafting' where id=pid; raise exception 'Published period reopened';
 exception when sqlstate 'P0001' then if sqlerrm='Published period reopened' then raise; end if; end;

end $$;
rollback;
select 'PASS: permissions, source binding, exclusive leases, atomic completion, stale inputs, canonical validation and publication guard; all rolled back' as result;
