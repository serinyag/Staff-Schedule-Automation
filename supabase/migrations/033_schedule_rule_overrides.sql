begin;
-- Rechecks in the same transaction must sort after earlier attestations.
alter table public.schedule_validation_checks alter column created_at set default clock_timestamp();
create table public.schedule_rule_overrides (
 id uuid primary key default gen_random_uuid(),period_id uuid not null references public.schedule_periods(id),
 input_hash text not null,draft_hash text not null,issue_hash text not null,issue jsonb not null,
 reason text not null check(length(trim(reason)) between 10 and 1000),approved_by uuid not null references public.profiles(id),approved_at timestamptz not null default now(),
 unique(period_id,input_hash,draft_hash,issue_hash)
);
alter table public.schedule_rule_overrides enable row level security;
revoke all on public.schedule_rule_overrides from public,anon,authenticated;
grant all on public.schedule_rule_overrides to service_role;
create function public.schedule_override_allowed(p_code text) returns boolean language sql immutable set search_path='' as $$
 select p_code in ('weekly_minimum_not_met','weekly_maximum_exceeded','boundary_weekly_maximum_exceeded','role_full_weekend_blocked','full_weekend_assignment','manager_weekend_days_off_missing','manager_consecutive_days_off_missing');
$$;
create function public.schedule_override_review(p_period_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb; begin
 perform public.schedule_require_manager();v:=public.schedule_current_validation(p_period_id);
 if v is null then return jsonb_build_object('issues','[]'::jsonb,'needs_check',true);end if;
 return jsonb_build_object('needs_check',false,'issues',coalesce((select jsonb_agg(jsonb_build_object('hash',public.schedule_json_hash(e),'code',e->>'code','message',e->>'message','staff_id',e->>'staff_id','week_start',e->>'week_start')) from jsonb_array_elements(v->'errors') e where public.schedule_override_allowed(e->>'code')),'[]'::jsonb));
end $$;
create function public.approve_schedule_rule_overrides(p_period_id uuid,p_issue_hashes text[],p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare v jsonb;e jsonb;ih text;dh text;h text;begin
 perform public.schedule_require_manager();perform pg_advisory_xact_lock(87124001);
 if length(trim(p_reason)) not between 10 and 1000 or p_reason is null then raise exception 'Add a reason of 10 to 1000 characters.';end if;
 if cardinality(p_issue_hashes) not between 1 and 50 or p_issue_hashes is null then raise exception 'Select the restrictions to override.';end if;
 if not exists(select 1 from public.schedule_periods where id=p_period_id and status not in ('published','locked')) then raise exception 'Only draft schedules can be overridden.';end if;
 v:=public.schedule_current_validation(p_period_id);if v is null then raise exception 'Recheck the current draft first.';end if;
 ih:=public.schedule_input_hash(p_period_id);dh:=public.schedule_json_hash(public.schedule_draft_rows(p_period_id));
 foreach h in array p_issue_hashes loop
  select value into e from jsonb_array_elements(v->'errors') where public.schedule_json_hash(value)=h and public.schedule_override_allowed(value->>'code');
  if e is null then raise exception 'This restriction changed or cannot be overridden. Refresh and recheck.';end if;
  insert into public.schedule_rule_overrides(period_id,input_hash,draft_hash,issue_hash,issue,reason,approved_by) values(p_period_id,ih,dh,h,e,trim(p_reason),auth.uid()) on conflict(period_id,input_hash,draft_hash,issue_hash) do nothing;
 end loop;
 insert into public.schedule_audit_events(period_id,actor_id,event,details) values(p_period_id,auth.uid(),'rule_overrides_approved',jsonb_build_object('issue_hashes',p_issue_hashes,'reason',trim(p_reason)));
end $$;
-- The trusted validator still runs before every publication. Apply only approvals
-- bound to precisely the inputs, assignments and full issue being rechecked.
alter function public.record_schedule_validation(uuid,uuid,text,text,text,jsonb,boolean) rename to record_schedule_validation_without_overrides;
create function public.record_schedule_validation(p_period_id uuid,p_actor_id uuid,p_input_hash text,p_draft_hash text,p_engine_version text,p_validation jsonb,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb:=p_validation;err jsonb:='[]';warn jsonb:=coalesce(p_validation->'warnings','[]');e jsonb;o public.schedule_rule_overrides;begin
 perform public.schedule_require_worker();perform public.schedule_require_manager(p_actor_id);perform pg_advisory_xact_lock(87124001);
 for e in select value from jsonb_array_elements(p_validation->'errors') loop
  select * into o from public.schedule_rule_overrides where period_id=p_period_id and input_hash=p_input_hash and draft_hash=p_draft_hash and issue_hash=public.schedule_json_hash(e) and public.schedule_override_allowed(e->>'code');
  if o.id is null then err:=err||jsonb_build_array(e);
  else warn:=warn||jsonb_build_array(e||jsonb_build_object('severity','warning','code','manager_rule_override','message',(e->>'message')||' Manager override: '||o.reason,'details',coalesce(e->'details','{}')||jsonb_build_object('override_reason',o.reason,'original_code',e->>'code','approved_by',o.approved_by,'approved_at',o.approved_at)));end if;
 end loop;
 v:=v||jsonb_build_object('errors',err,'warnings',warn,'valid',jsonb_array_length(err)=0,'ready_for_commit',jsonb_array_length(err)=0 and jsonb_array_length(coalesce(v->'review_items','[]'))=0);
 return public.record_schedule_validation_without_overrides(p_period_id,p_actor_id,p_input_hash,p_draft_hash,p_engine_version,v,p_publish);
end $$;
revoke execute on function public.schedule_override_allowed(text),public.schedule_override_review(uuid),public.approve_schedule_rule_overrides(uuid,text[],text),public.record_schedule_validation_without_overrides(uuid,uuid,text,text,text,jsonb,boolean),public.record_schedule_validation(uuid,uuid,text,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.schedule_override_review(uuid),public.approve_schedule_rule_overrides(uuid,text[],text) to authenticated;
grant execute on function public.record_schedule_validation(uuid,uuid,text,text,text,jsonb,boolean) to service_role;
commit;
