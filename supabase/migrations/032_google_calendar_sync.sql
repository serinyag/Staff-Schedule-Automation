begin;
create table public.google_calendar_connection (
 singleton boolean primary key default true check(singleton),
 refresh_token_ciphertext text not null,
 calendar_id text,
 calendar_name text,
 auto_sync boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.google_calendar_jobs (
 id uuid primary key default gen_random_uuid(),
 period_id uuid not null references public.schedule_periods(id),
 calendar_id text not null,
 status text not null default 'queued' check(status in ('queued','syncing','synced','failed','cancelled')),
 attempts int not null default 0,
 lease_until timestamptz,
 lease_token uuid,
 synced_at timestamptz,
 error_message text,
 unique(period_id,calendar_id)
);
alter table public.google_calendar_connection enable row level security;
alter table public.google_calendar_jobs enable row level security;
revoke all on public.google_calendar_connection,public.google_calendar_jobs from public,anon,authenticated;
grant all on public.google_calendar_connection,public.google_calendar_jobs to service_role;
create function public.enqueue_published_calendar_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='published' and old.status is distinct from new.status then
  insert into public.google_calendar_jobs(period_id,calendar_id)
   select new.id,calendar_id from public.google_calendar_connection where auto_sync and calendar_id is not null
   on conflict(period_id,calendar_id) do nothing;
 end if;
 return new;
end $$;
create trigger google_calendar_publication after update on public.schedule_periods for each row execute function public.enqueue_published_calendar_sync();
create function public.claim_google_calendar_job(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.google_calendar_jobs; begin
 perform public.schedule_require_worker();
 update public.google_calendar_jobs set status='syncing',attempts=attempts+1,lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid(),error_message=null
 where id=p_id and attempts<5 and (status in ('queued','failed') or (status='syncing' and lease_until<now())) returning * into j;
 return to_jsonb(j);
end $$;
revoke execute on function public.enqueue_published_calendar_sync(),public.claim_google_calendar_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_google_calendar_job(uuid) to service_role;
commit;
