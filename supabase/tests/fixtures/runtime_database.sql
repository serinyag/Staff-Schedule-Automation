-- Minimal isolated PostgreSQL fixture for transaction/permissions regressions.
-- This is not a replacement for testing the migration against the linked schema.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select current_setting('request.jwt.claims',true)::jsonb->>'role'$$;
grant usage on schema public,auth to anon,authenticated,service_role;
create type public.schedule_generation_run_status as enum ('queued','analyzing_availability','planning','fairness_review','validating','completed','failed','cancelled');
create type public.issue_severity as enum ('block','warning');
create table public.profiles(id uuid primary key,is_active boolean,app_role text);
create table public.schedule_periods(id uuid primary key default gen_random_uuid(),name text,start_date date,end_date date,status text,
 monthly_staff_budget_eur numeric,availability_revision bigint default 0,validated_availability_revision bigint default -1,
 published_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.staff_members(id uuid primary key,is_active boolean,profile_id uuid);
create table public.shifts(id uuid primary key default gen_random_uuid(),period_id uuid references public.schedule_periods(id),shift_date date,
 shift_type text,is_optional boolean,required_count int,start_time time,end_time time,notes text);
create table public.shift_assignments(id uuid primary key default gen_random_uuid(),shift_id uuid references public.shifts(id) on delete cascade,
 staff_id uuid references public.staff_members(id),lifecycle text default 'draft',status text default 'assigned',generation_run_id uuid,
 assignment_kind text default 'coverage',assigned_by uuid,assigned_at timestamptz,manager_note text,updated_at timestamptz default now());
create table public.schedule_generation_runs(id uuid primary key default gen_random_uuid(),period_id uuid references public.schedule_periods(id),
 status public.schedule_generation_run_status default 'queued',initiated_by uuid references public.profiles(id),current_stage text default 'queued',metadata jsonb default '{}',
 started_at timestamptz default now(),completed_at timestamptz,failed_at timestamptz,failure_message text,created_at timestamptz default now(),updated_at timestamptz default now());
create unique index active_period on public.schedule_generation_runs(period_id) where status in ('queued','planning','validating','analyzing_availability','fairness_review');
create table public.availability_submissions(id uuid primary key default gen_random_uuid(),period_id uuid,staff_id uuid,status text);
create table public.availability_days(id uuid primary key default gen_random_uuid(),submission_id uuid,available_date date,morning boolean,day boolean,evening boolean);
create function public.get_schedule_planning_context(pid uuid) returns jsonb language sql as $$select jsonb_build_object('period',to_jsonb(p)-'validated_availability_revision'-'availability_revision','staff',(select jsonb_agg(s) from public.staff_members s),'shifts',(select jsonb_agg(s order by id) from public.shifts s where s.period_id=pid)) from public.schedule_periods p where id=pid$$;
create function public.validate_schedule_period(p_period_id uuid) returns table(code text,severity public.issue_severity,message text,issue_date date,staff_id uuid,shift_id uuid) language sql as $$select null::text,null::public.issue_severity,null::text,null::date,null::uuid,null::uuid where false$$;
create function public.publish_schedule_period(p_period_id uuid) returns void language plpgsql as $$begin end$$;
create function public.revalidate_availability_draft(p_period_id uuid) returns void language plpgsql as $$begin end$$;
create function public.queue_schedule_generation_run(p_period_id uuid) returns uuid language sql as $$select gen_random_uuid()$$;
create function public.guard_schedule_publication() returns trigger language plpgsql as $$begin return new;end$$;
create trigger availability_publication_guard before update on public.schedule_periods for each row execute function public.guard_schedule_publication();
create function public.save_draft_assignments(p_generation_run_id uuid,p_period_id uuid,p_assignments jsonb) returns jsonb language plpgsql as $$begin
 delete from public.shift_assignments a using public.shifts s where s.id=a.shift_id and s.period_id=p_period_id and a.lifecycle='draft';
 insert into public.shift_assignments(shift_id,staff_id,generation_run_id,assignment_kind,manager_note) select (x->>'shift_id')::uuid,(x->>'staff_id')::uuid,p_generation_run_id,x->>'assignment_kind',x->>'planning_reason' from jsonb_array_elements(p_assignments) x;
 return '{}';end$$;
create function public.save_generated_schedule_draft(p_generation_run_id uuid,p_period_id uuid,p_assignments jsonb,p_proposed_shifts jsonb default '[]') returns jsonb language plpgsql as $$begin
 if jsonb_array_length(p_proposed_shifts)>0 then raise exception 'Invalid proposal';end if;
 return public.save_draft_assignments(p_generation_run_id,p_period_id,p_assignments);end$$;
insert into public.profiles values('11111111-1111-4111-8111-111111111111',true,'admin');
insert into public.staff_members values('22222222-2222-4222-8222-222222222222',true,'11111111-1111-4111-8111-111111111111');
insert into public.schedule_periods(id,start_date,end_date,status,monthly_staff_budget_eur) values('33333333-3333-4333-8333-333333333333','2026-08-01','2026-08-31','drafting',5000),('44444444-4444-4444-8444-444444444444','2026-09-01','2026-09-30','drafting',5000);
insert into public.shifts(id,period_id,shift_date,shift_type,is_optional,required_count) values('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','2026-08-01','morning',false,1);
insert into public.shift_assignments(shift_id,staff_id) values('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222');
