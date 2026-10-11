begin;

-- Jobs are persisted independently of an HTTP request. Only trusted workers may
-- claim/finalize them; every completion is fenced by a fresh lease token.
alter table public.schedule_generation_runs
 add column job_mode text not null default 'standard' check(job_mode in ('standard','flexible_preview','adopt_flexible')),
 add column preview_run_id uuid references public.schedule_generation_runs(id),
 add column attempt_count integer not null default 0,
 add column lease_token uuid,
 add column lease_expires_at timestamptz,
 add column input_snapshot jsonb,
 add column input_hash text,
 add column baseline_hash text,
 add column last_error_code text;
alter table public.schedule_periods add column draft_schedule_mode text not null default 'standard' check(draft_schedule_mode in ('standard','flexible'));

create table public.schedule_runtime_policy (
 singleton boolean primary key default true check(singleton), engine_version text not null
);
insert into public.schedule_runtime_policy values(true,'0.8.0');
alter table public.schedule_runtime_policy enable row level security;
revoke all on public.schedule_runtime_policy from anon,authenticated;

create table public.schedule_validation_checks (
 id uuid primary key default gen_random_uuid(), period_id uuid not null references public.schedule_periods(id) on delete cascade,
 actor_id uuid not null references public.profiles(id), input_hash text not null, draft_hash text not null,
 engine_version text not null, validation jsonb not null, created_at timestamptz not null default now()
);
create index schedule_validation_checks_period_created on public.schedule_validation_checks(period_id,created_at desc);
alter table public.schedule_validation_checks enable row level security;
create table public.schedule_audit_events (
 id uuid primary key default gen_random_uuid(), period_id uuid not null references public.schedule_periods(id),
 actor_id uuid not null references public.profiles(id), event text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index schedule_audit_events_period_created on public.schedule_audit_events(period_id,created_at desc);
alter table public.schedule_audit_events enable row level security;
create policy manager_validation_read on public.schedule_validation_checks for select to authenticated using(
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.app_role in ('admin','manager')));
create policy manager_audit_read on public.schedule_audit_events for select to authenticated using(
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.app_role in ('admin','manager')));
revoke all on public.schedule_validation_checks,public.schedule_audit_events from anon,authenticated;
grant select on public.schedule_validation_checks,public.schedule_audit_events to authenticated;

create function public.schedule_require_manager(p_actor uuid default auth.uid()) returns void
language plpgsql security definer set search_path='' as $$ begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and is_active and app_role in ('admin','manager')) then
 raise exception 'Manager access required.' using errcode='42501'; end if;
end $$;
create function public.schedule_require_worker() returns void language plpgsql set search_path='' as $$ begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker access required.' using errcode='42501'; end if;
end $$;
-- Serialize small snapshot/save/publish transactions with all planning-input
-- writes. This lock is never held while the optimizer is running.
create function public.schedule_write_gate() returns trigger language plpgsql set search_path='' as $$ begin
 perform pg_advisory_xact_lock(87124001);
 if TG_OP='DELETE' then return old; else return new; end if;
end $$;
do $$ declare t text; begin
 foreach t in array array['profiles','staff_members','employment_contracts','staff_training_status','staff_scheduling_preferences',
 'role_scheduling_rules','scheduling_settings','availability_submissions','availability_days','staff_period_budgets',
 'schedule_periods','shifts','shift_assignments','approved_exceptions','schedule_budgets','staff_holiday_exemptions'] loop
 if to_regclass('public.'||t) is not null then execute format('create trigger schedule_input_write_gate before insert or update or delete on public.%I for each statement execute function public.schedule_write_gate()',t); end if;
 end loop;
end $$;

create function public.schedule_stable_json(p_value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare answer jsonb; begin
 if jsonb_typeof(p_value)='object' then
 select coalesce(jsonb_object_agg(key,public.schedule_stable_json(value)),'{}') into answer from jsonb_each(p_value)
 where key not in ('generated_at','updated_at','created_at');
 elsif jsonb_typeof(p_value)='array' then
 select coalesce(jsonb_agg(public.schedule_stable_json(value) order by ordinality),'[]') into answer from jsonb_array_elements(p_value) with ordinality;
 else answer:=p_value; end if; return answer;
end $$;
create function public.schedule_json_hash(p_value jsonb) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(public.schedule_stable_json(p_value)::text,'UTF8')),'hex');
$$;
create function public.schedule_draft_rows(p_period_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('staff_id',a.staff_id,'shift_id',a.shift_id,'assignment_kind',a.assignment_kind,'manager_note',a.manager_note)
 order by a.staff_id,a.shift_id,a.assignment_kind),'[]') from public.shift_assignments a join public.shifts s on s.id=a.shift_id
 where s.period_id=p_period_id and a.lifecycle='draft' and a.status='assigned';
$$;
create function public.schedule_snapshot_context(p_period_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select public.get_schedule_planning_context(p_period_id)||jsonb_build_object('draft_schedule_mode',sp.draft_schedule_mode)
 from public.schedule_periods sp where sp.id=p_period_id;
$$;
create function public.schedule_input_hash(p_period_id uuid) returns text language sql stable security definer set search_path='' as $$
 select public.schedule_json_hash(public.schedule_snapshot_context(p_period_id));
$$;

-- Keep internal legacy writers for the atomic completion RPC. Browser clients
-- must not replace generated drafts, mutate run metadata, or forge validations.
revoke insert,update,delete on public.schedule_generation_runs,public.shift_assignments,public.shifts from authenticated,anon;
revoke execute on function public.save_draft_assignments(uuid,uuid,jsonb),public.save_generated_schedule_draft(uuid,uuid,jsonb,jsonb) from authenticated,anon,public;
drop policy if exists "schedule_generation_runs manager insert" on public.schedule_generation_runs;
drop policy if exists "schedule_generation_runs manager update" on public.schedule_generation_runs;

create or replace function public.queue_schedule_generation_run(p_period_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$ begin
 return public.queue_schedule_job(p_period_id,'standard',null);
end $$;
create function public.queue_schedule_job(p_period_id uuid,p_mode text default 'standard',p_preview_run_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare r uuid; p public.schedule_periods%rowtype; ctx jsonb; baseline jsonb; preview public.schedule_generation_runs%rowtype;
begin
 perform public.schedule_require_manager(); perform pg_advisory_xact_lock(87124001);
 if p_mode not in ('standard','flexible_preview','adopt_flexible') then raise exception 'Unknown scheduling mode.'; end if;
 select * into p from public.schedule_periods where id=p_period_id for update;
 if p.id is null then raise exception 'Schedule period not found.' using errcode='P0002'; end if;
 if p.status in ('published','locked') then raise exception 'Published or locked schedules cannot be regenerated.'; end if;
 -- Preserve active leases; terminalize jobs that outlived their durable delivery window.
 perform public.recover_expired_schedule_runs(p_period_id);
 if exists(select 1 from public.schedule_generation_runs where period_id=p_period_id and status in ('queued','planning','validating','analyzing_availability','fairness_review')) then
 raise exception 'A schedule generation run is already active for this period.' using errcode='23505'; end if;
 if exists(select 1 from public.schedule_generation_runs where initiated_by=auth.uid() and created_at>now()-interval '1 minute' group by initiated_by having count(*)>=3) then
 raise exception 'Please wait a minute before generating another schedule.' using errcode='P0001'; end if;
 if exists(select 1 from public.staff_members sm where sm.is_active and not exists(select 1 from public.availability_submissions a where a.period_id=p_period_id and a.staff_id=sm.id and a.status='submitted')) then
 raise exception 'All active staff must submit availability before generation.'; end if;
 update public.schedule_periods set status='drafting' where id=p_period_id;
 ctx:=public.schedule_snapshot_context(p_period_id); baseline:=public.schedule_draft_rows(p_period_id);
 if octet_length(ctx::text)>2000000 or p.end_date-p.start_date>31 then raise exception 'This planning period is too large. Choose one month.'; end if;
 if p_mode='flexible_preview' and jsonb_array_length(baseline)=0 then raise exception 'Generate a standard draft first.'; end if;
 if p_mode='adopt_flexible' then
 select * into preview from public.schedule_generation_runs where id=p_preview_run_id and period_id=p_period_id and status='completed' and job_mode='flexible_preview';
 if preview.id is null or preview.input_hash<>public.schedule_json_hash(ctx) or preview.baseline_hash<>public.schedule_json_hash(baseline)
 or preview.metadata->'preview_result'->>'engine_version'<>(select engine_version from public.schedule_runtime_policy where singleton) then
 raise exception 'The inputs or draft changed. Generate a fresh flexible preview.'; end if;
 end if;
 insert into public.schedule_generation_runs(period_id,initiated_by,job_mode,preview_run_id,input_snapshot,input_hash,baseline_hash,metadata)
 values(p_period_id,auth.uid(),p_mode,p_preview_run_id,jsonb_build_object('context',ctx,'baseline',baseline),public.schedule_json_hash(ctx),public.schedule_json_hash(baseline),
 jsonb_build_object('availability_revision',p.availability_revision)) returning id into r;
 return r;
end $$;

create function public.recover_expired_schedule_runs(p_period_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.schedule_require_manager();
 update public.schedule_generation_runs set status='failed',failed_at=now(),current_stage='failed',last_error_code='job_expired',
 failure_message='Generation was interrupted. The saved draft is unchanged; please try again.'
 where period_id=p_period_id and status in ('queued','planning','validating','analyzing_availability','fairness_review')
 and created_at<now()-interval '1 hour' and coalesce(lease_expires_at,'-infinity')<now();
end $$;
create function public.cancel_undispatched_schedule_job(p_run_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.schedule_require_manager();
 -- Queue publication may have succeeded despite a network timeout. A worker that
 -- already claimed the job must not be cancelled by the producer.
 update public.schedule_generation_runs set status='failed',failed_at=now(),current_stage='failed',last_error_code='dispatch_failed',
 failure_message='Generation could not start. Please try again.' where id=p_run_id and initiated_by=auth.uid() and status='queued' and attempt_count=0;
end $$;
create function public.claim_schedule_job(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.schedule_generation_runs%rowtype; p public.schedule_periods%rowtype; token uuid; preview jsonb;
begin
 perform public.schedule_require_worker(); perform pg_advisory_xact_lock(87124001);
 select * into r from public.schedule_generation_runs where id=p_run_id for update;
 if r.id is null then raise exception 'Run not found.' using errcode='P0002'; end if;
 if r.status in ('completed','failed','cancelled') then return jsonb_build_object('state','done'); end if;
 if r.lease_expires_at>now() then return jsonb_build_object('state','busy'); end if;
 select * into p from public.schedule_periods where id=r.period_id for update;
 if not exists(select 1 from public.profiles where id=r.initiated_by and is_active and app_role in ('admin','manager')) or p.status<>'drafting'
 or r.attempt_count>=3 or r.created_at<now()-interval '1 hour' or r.input_hash is distinct from public.schedule_input_hash(r.period_id)
 or r.baseline_hash is distinct from public.schedule_json_hash(public.schedule_draft_rows(r.period_id)) then
 update public.schedule_generation_runs set status='failed',current_stage='failed',failed_at=now(),last_error_code='stale_or_expired',
 failure_message='The inputs or draft changed, or generation was interrupted. Create a new schedule.' where id=r.id;
 return jsonb_build_object('state','failed'); end if;
 token:=gen_random_uuid();
 update public.schedule_generation_runs set status='planning',current_stage='planning',attempt_count=attempt_count+1,
 lease_token=token,lease_expires_at=now()+interval '4 minutes' where id=r.id;
 if r.job_mode='adopt_flexible' then select metadata->'preview_result' into preview from public.schedule_generation_runs where id=r.preview_run_id; end if;
 return jsonb_build_object('state','claimed','lease_token',token,'period_id',r.period_id,'mode',r.job_mode,
 'attempt',r.attempt_count+1,'context',r.input_snapshot->'context','baseline',r.input_snapshot->'baseline','preview',preview);
end $$;

create function public.finish_schedule_job(p_run_id uuid,p_lease_token uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.schedule_generation_runs%rowtype; p public.schedule_periods%rowtype; saved jsonb; meta jsonb; assignments jsonb;
begin
 perform public.schedule_require_worker(); perform pg_advisory_xact_lock(87124001);
 select * into r from public.schedule_generation_runs where id=p_run_id for update;
 if r.status='completed' then return jsonb_build_object('state','completed'); end if;
 if r.id is null or r.lease_token is distinct from p_lease_token or r.lease_expires_at<now() or r.status<>'planning' then raise exception 'Worker lease expired.'; end if;
 perform public.schedule_require_manager(r.initiated_by);
 select * into p from public.schedule_periods where id=r.period_id for update;
 if p.status<>'drafting' or r.input_hash is distinct from public.schedule_input_hash(r.period_id)
 or r.baseline_hash is distinct from public.schedule_json_hash(public.schedule_draft_rows(r.period_id)) then raise exception 'Inputs or draft changed while generating.'; end if;
 if p_result->>'engine_version' is distinct from (select engine_version from public.schedule_runtime_policy where singleton)
 or jsonb_typeof(p_result->'draft_assignments') is distinct from 'array' or jsonb_typeof(p_result->'validation'->'errors') is distinct from 'array' then raise exception 'Invalid engine result.'; end if;
 if r.job_mode='flexible_preview' then
 meta:=r.metadata||jsonb_build_object('preview_kind','flexible','preview_result',p_result,'comparison',p_result->'comparison');
 else
 assignments:=p_result->'draft_assignments';
 if jsonb_array_length(assignments)>0 then
 -- Legacy authorized writer checks auth.uid(); set it to the verified initiator
 -- only inside this trusted transaction. Never store a user's login token.
 perform set_config('request.jwt.claim.sub',r.initiated_by::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',r.initiated_by,'role','service_role')::text,true);
 saved:=public.save_generated_schedule_draft(r.id,r.period_id,assignments,coalesce(p_result->'proposed_shifts','[]'));
 update public.schedule_periods set draft_schedule_mode=case when r.job_mode='adopt_flexible' then 'flexible' else 'standard' end where id=r.period_id;
 end if;
 meta:=r.metadata||p_result||jsonb_build_object('schedule_mode',case when r.job_mode='adopt_flexible' then 'flexible' else 'standard' end,
 'adopted_preview_id',r.preview_run_id,'manager_review',jsonb_build_object('status',p_result->'generation_status','headline','Review generated schedule',
 'ready_for_commit',p_result->'validation'->'ready_for_commit','requires_human_review',true,'blocking_issues',p_result->'validation'->'errors',
 'soft_warnings',coalesce((select jsonb_agg(x->>'message') from jsonb_array_elements(p_result->'validation'->'warnings') x),'[]'),
 'human_review_flags',coalesce((select jsonb_agg(x->>'message') from jsonb_array_elements(p_result->'validation'->'review_items') x),'[]')));
 end if;
 update public.schedule_generation_runs set status=case when r.job_mode='flexible_preview' or jsonb_array_length(p_result->'draft_assignments')>0 then 'completed'::public.schedule_generation_run_status else 'failed'::public.schedule_generation_run_status end,
 current_stage=case when r.job_mode='flexible_preview' then 'flexible_preview' when jsonb_array_length(p_result->'draft_assignments')=0 then 'manager_review_required' else 'completed' end,completed_at=now(),metadata=meta,lease_expires_at=null,
 failure_message=case when r.job_mode<>'flexible_preview' and jsonb_array_length(p_result->'draft_assignments')=0 then 'No feasible draft found. Review availability and constraints.' else null end where id=r.id;
 insert into public.schedule_audit_events(period_id,actor_id,event,details) values(r.period_id,r.initiated_by,'generation_finished',jsonb_build_object('run_id',r.id,'mode',r.job_mode));
 return jsonb_build_object('state','completed');
end $$;
create function public.fail_schedule_job(p_run_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean) returns jsonb
language plpgsql security definer set search_path='' as $$ declare r public.schedule_generation_runs%rowtype; retry boolean; begin
 perform public.schedule_require_worker(); select * into r from public.schedule_generation_runs where id=p_run_id for update;
 if r.status in ('completed','failed','cancelled') then return jsonb_build_object('state','done'); end if;
 if r.lease_token is distinct from p_lease_token then return jsonb_build_object('state','retry'); end if;
 retry:=p_retryable and r.attempt_count<3;
 update public.schedule_generation_runs set status=case when retry then 'queued'::public.schedule_generation_run_status else 'failed'::public.schedule_generation_run_status end,
 current_stage=case when retry then 'retrying' else 'failed' end,lease_expires_at=null,failed_at=case when retry then null else now() end,
 last_error_code=left(p_error_code,60),failure_message=case when retry then 'Generation interrupted; retrying automatically.'
 when p_error_code='inputs_changed' then 'Inputs or draft changed. Create a new schedule.' else 'Generation could not finish. The saved draft is unchanged; please try again.' end where id=r.id;
 return jsonb_build_object('state',case when retry then 'retry' else 'failed' end);
end $$;

-- All edits take the same period lock and are committed with their audit event.
create function public.edit_schedule_assignment(p_period_id uuid,p_action text,p_shift_id uuid default null,p_staff_id uuid default null,p_assignment_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare p public.schedule_periods%rowtype; a public.shift_assignments%rowtype; s public.shifts%rowtype; staff uuid;
begin
 perform public.schedule_require_manager(); perform pg_advisory_xact_lock(87124001);
 select * into p from public.schedule_periods where id=p_period_id for update;
 if p.id is null then raise exception 'Schedule period not found.' using errcode='P0002'; end if;
 if p.status in ('published','locked') then raise exception 'Published or locked schedules cannot be edited.'; end if;
 if p_action not in ('assign','move','remove') then raise exception 'Invalid assignment action.'; end if;
 if p_action in ('move','remove') then
 select sa.* into a from public.shift_assignments sa join public.shifts sh on sh.id=sa.shift_id where sa.id=p_assignment_id and sh.period_id=p_period_id for update of sa;
 if a.id is null then raise exception 'Assignment not found in this schedule period.' using errcode='P0002'; end if;
 if a.lifecycle<>'draft' then raise exception 'Only draft assignments can be edited.'; end if;
 if p_action='remove' then
 update public.shift_assignments set status='cancelled',updated_at=now() where id=a.id;
 else
 if a.status<>'assigned' then raise exception 'Only active assignments can be moved.'; end if;
 staff:=a.staff_id;
 end if;
 else staff:=p_staff_id; end if;
 if p_action<>'remove' then
 select * into s from public.shifts where id=p_shift_id and period_id=p_period_id;
 if s.id is null then raise exception 'Shift not found in this schedule period.' using errcode='P0002'; end if;
 if not exists(select 1 from public.staff_members where id=staff and is_active) then raise exception 'Choose an active staff member.'; end if;
 if exists(select 1 from public.availability_submissions sub join public.availability_days d on d.submission_id=sub.id
 where sub.period_id=p_period_id and sub.staff_id=staff and sub.status='submitted' and d.available_date=s.shift_date
 and not case s.shift_type when 'morning' then d.morning when 'day' then d.day else d.evening end) then raise exception 'This staff member is not available that day.'; end if;
 if p_action='move' and a.shift_id=p_shift_id then return; end if;
 if exists(select 1 from public.shift_assignments where shift_id=s.id and staff_id=staff and status='assigned') then raise exception 'That staff member is already assigned to this shift.'; end if;
 if p_action='move' then update public.shift_assignments set shift_id=s.id,updated_at=now() where id=a.id;
 else insert into public.shift_assignments(shift_id,staff_id,status,lifecycle,assigned_by,assigned_at,assignment_kind) values(s.id,staff,'assigned','draft',auth.uid(),now(),'coverage'); end if;
 end if;
 update public.schedule_periods set status='drafting',validated_availability_revision=-1 where id=p_period_id;
 insert into public.schedule_audit_events(period_id,actor_id,event,details) values(p_period_id,auth.uid(),'assignment_'||p_action,jsonb_build_object('assignment_id',p_assignment_id,'shift_id',p_shift_id,'staff_id',staff));
end $$;
create function public.edit_schedule_day_shift(p_period_id uuid,p_action text,p_date date default null,p_shift_id uuid default null)
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
 select * into s from public.shifts where id=p_shift_id and period_id=p_period_id and shift_type='day' and is_optional;
 if s.id is null then raise exception 'Optional day shift not found.' using errcode='P0002'; end if;
 if exists(select 1 from public.shift_assignments where shift_id=s.id and status='assigned') then raise exception 'Remove assignments before removing this day shift.'; end if;
 delete from public.shifts where id=s.id;
 else raise exception 'Invalid day-shift action.'; end if;
 update public.schedule_periods set validated_availability_revision=-1 where id=p_period_id;
 insert into public.schedule_audit_events(period_id,actor_id,event,details) values(p_period_id,auth.uid(),'day_shift_'||p_action,jsonb_build_object('shift_id',p_shift_id,'date',p_date));
end $$;

create function public.schedule_review_snapshot(p_period_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.schedule_periods%rowtype; ctx jsonb; rows jsonb; begin
 perform public.schedule_require_manager(); perform pg_advisory_xact_lock(87124001);
 select * into p from public.schedule_periods where id=p_period_id for update;
 if p.id is null then raise exception 'Schedule period not found.' using errcode='P0002'; end if;
 if p.status in ('published','locked') then raise exception 'Only draft schedules can be reviewed for publication.'; end if;
 if (select count(*) from public.schedule_audit_events where actor_id=auth.uid() and event='review_requested' and created_at>now()-interval '1 minute')>=10 then raise exception 'Please wait a minute before checking again.'; end if;
 insert into public.schedule_audit_events(period_id,actor_id,event) values(p_period_id,auth.uid(),'review_requested');
 ctx:=public.schedule_snapshot_context(p_period_id); rows:=public.schedule_draft_rows(p_period_id);
 return jsonb_build_object('actor_id',auth.uid(),'context',ctx,'assignments',rows,'mode',p.draft_schedule_mode,
 'input_hash',public.schedule_json_hash(ctx),'draft_hash',public.schedule_json_hash(rows));
end $$;
create function public.schedule_current_validation(p_period_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select c.validation from public.schedule_validation_checks c join public.schedule_runtime_policy pol on pol.singleton and c.engine_version=pol.engine_version
 where c.period_id=p_period_id and c.input_hash=public.schedule_input_hash(p_period_id)
 and c.draft_hash=public.schedule_json_hash(public.schedule_draft_rows(p_period_id)) order by c.created_at desc,c.id desc limit 1;
$$;
create or replace function public.guard_schedule_publication() returns trigger language plpgsql set search_path='' as $$
declare v jsonb; begin
 if new.status='published' and old.status<>'published' then
 perform pg_advisory_xact_lock(87124001); v:=public.schedule_current_validation(new.id);
 if v is null or jsonb_typeof(v->'errors') is distinct from 'array' or jsonb_array_length(v->'errors')<>0
 or v->>'ready_for_commit' is distinct from 'true' then raise exception 'Run the schedule check on the current draft before publishing.'; end if;
 end if;
 return new;
end $$;
create or replace function public.revalidate_availability_draft(p_period_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v jsonb; begin
 perform public.schedule_require_manager(); perform pg_advisory_xact_lock(87124001);
 perform 1 from public.schedule_periods where id=p_period_id for update;
 v:=public.schedule_current_validation(p_period_id);
 if v is null or v->>'ready_for_commit' is distinct from 'true' or jsonb_array_length(v->'errors')<>0 then
 raise exception 'Run the schedule check and resolve blocking issues first.'; end if;
 update public.schedule_periods set validated_availability_revision=availability_revision where id=p_period_id;
end $$;
create or replace function public.publish_schedule_period(p_period_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.schedule_periods%rowtype; v jsonb; begin
 perform public.schedule_require_manager(); perform pg_advisory_xact_lock(87124001);
 select * into p from public.schedule_periods where id=p_period_id for update;
 if p.id is null then raise exception 'Schedule period not found.' using errcode='P0002'; end if;
 if p.status in ('published','locked') then raise exception 'This period is already published or locked.'; end if;
 if not exists(select 1 from public.shift_assignments a join public.shifts s on s.id=a.shift_id where s.period_id=p_period_id and a.status='assigned' and a.lifecycle='draft') then raise exception 'There is no draft schedule to publish.'; end if;
 v:=public.schedule_current_validation(p_period_id);
 if v is null or v->>'ready_for_commit' is distinct from 'true' or jsonb_array_length(v->'errors')<>0 then
 raise exception 'Run the schedule check and resolve blocking issues first.'; end if;
 -- The period trigger verifies the attestation while the draft still exists.
 update public.schedule_periods set status='published',published_at=now(),validated_availability_revision=availability_revision where id=p_period_id;
 update public.shift_assignments a set lifecycle='published',updated_at=now() from public.shifts s where s.id=a.shift_id and s.period_id=p_period_id and a.lifecycle='draft';
 insert into public.schedule_audit_events(period_id,actor_id,event) values(p_period_id,auth.uid(),'schedule_published');
end $$;
create function public.record_schedule_validation(p_period_id uuid,p_actor_id uuid,p_input_hash text,p_draft_hash text,p_engine_version text,p_validation jsonb,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$ declare ready boolean; begin
 perform public.schedule_require_worker(); perform public.schedule_require_manager(p_actor_id); perform pg_advisory_xact_lock(87124001);
 perform 1 from public.schedule_periods where id=p_period_id for update;
 if p_input_hash is distinct from public.schedule_input_hash(p_period_id) or p_draft_hash is distinct from public.schedule_json_hash(public.schedule_draft_rows(p_period_id)) then raise exception 'Inputs or draft changed while checking. Please check again.'; end if;
 if p_engine_version is distinct from (select engine_version from public.schedule_runtime_policy where singleton)
 or p_validation->>'engine_version' is distinct from p_engine_version or jsonb_typeof(p_validation->'errors') is distinct from 'array' then raise exception 'Invalid validator result.'; end if;
 insert into public.schedule_validation_checks(period_id,actor_id,input_hash,draft_hash,engine_version,validation)
 values(p_period_id,p_actor_id,p_input_hash,p_draft_hash,p_engine_version,p_validation);
 ready:=p_validation->>'ready_for_commit'='true' and jsonb_array_length(p_validation->'errors')=0;
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','service_role')::text,true);
 if ready then
 if p_publish then perform public.publish_schedule_period(p_period_id);
 else perform public.revalidate_availability_draft(p_period_id); end if;
 end if;
 insert into public.schedule_audit_events(period_id,actor_id,event,details) values(p_period_id,p_actor_id,'schedule_checked',jsonb_build_object('ready',ready,'engine_version',p_engine_version));
 return jsonb_build_object('ready',ready);
end $$;

-- Preserve legacy diagnostics only as a fallback for drafts not yet checked.
-- Publication NEVER relies on that older implementation.
alter function public.validate_schedule_period(uuid) rename to validate_schedule_period_legacy;
create function public.validate_schedule_period(p_period_id uuid)
returns table(code text,severity public.issue_severity,message text,issue_date date,staff_id uuid,shift_id uuid)
language plpgsql stable security definer set search_path='' as $$ declare v jsonb; begin
 perform public.schedule_require_manager(); v:=public.schedule_current_validation(p_period_id);
 if v is null then
 return query select legacy.* from public.validate_schedule_period_legacy(p_period_id) legacy
 where not exists(select 1 from public.shifts s where s.id=legacy.shift_id and s.is_optional and s.shift_type='day' and legacy.code='missing_coverage');
 else
 return query select x->>'code',case when x->>'severity'='error' then 'block'::public.issue_severity else 'warning'::public.issue_severity end,
 x->>'message',(x->>'week_start')::date,(x->>'staff_id')::uuid,(x->>'shift_id')::uuid
 from jsonb_array_elements(coalesce(v->'errors','[]')||coalesce(v->'warnings','[]')||coalesce(v->'review_items','[]')) x;
 end if;
end $$;

-- Prevent changing a published period back to draft through a direct table update.
create function public.guard_published_schedule_period() returns trigger language plpgsql set search_path='' as $$ begin
 if old.status in ('published','locked') and (
 (to_jsonb(new)-'updated_at'-'status') is distinct from (to_jsonb(old)-'updated_at'-'status')
 or new.status is distinct from old.status and not(old.status='published' and new.status='locked')) then
 raise exception 'Published schedules are immutable.'; end if;
 return new;
end $$;
create trigger published_period_guard before update on public.schedule_periods for each row execute function public.guard_published_schedule_period();

-- Expose only the intended API. Helpers are not callable from the public Data API.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('schedule_require_manager','schedule_require_worker','schedule_write_gate','schedule_stable_json','schedule_json_hash',
 'schedule_draft_rows','schedule_snapshot_context','schedule_input_hash','schedule_current_validation','claim_schedule_job','finish_schedule_job','fail_schedule_job','record_schedule_validation',
 'queue_schedule_job','recover_expired_schedule_runs','cancel_undispatched_schedule_job','edit_schedule_assignment','edit_schedule_day_shift','schedule_review_snapshot','validate_schedule_period_legacy') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.queue_schedule_job(uuid,text,uuid),public.recover_expired_schedule_runs(uuid),public.cancel_undispatched_schedule_job(uuid),
 public.edit_schedule_assignment(uuid,text,uuid,uuid,uuid),public.edit_schedule_day_shift(uuid,text,date,uuid),public.schedule_review_snapshot(uuid),public.validate_schedule_period(uuid) to authenticated;
grant execute on function public.claim_schedule_job(uuid),public.finish_schedule_job(uuid,uuid,jsonb),public.fail_schedule_job(uuid,uuid,text,boolean),
 public.record_schedule_validation(uuid,uuid,text,text,text,jsonb,boolean) to service_role;
revoke execute on function public.publish_schedule_period(uuid),public.revalidate_availability_draft(uuid),public.queue_schedule_generation_run(uuid) from public,anon;
grant execute on function public.publish_schedule_period(uuid),public.revalidate_availability_draft(uuid),public.queue_schedule_generation_run(uuid) to authenticated;
commit;
