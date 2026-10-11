begin;
do $$ declare p uuid; begin
 if exists(select 1 from public.google_calendar_connection) then raise exception 'Expected unconfigured calendar'; end if;
 insert into public.schedule_periods(name,status) values('Calendar test','drafting') returning id into p;
 alter table public.schedule_periods disable trigger availability_publication_guard;
 update public.schedule_periods set status='published' where id=p;
 if exists(select 1 from public.google_calendar_jobs where period_id=p) then raise exception 'Disabled sync created job'; end if;
 insert into public.google_calendar_connection(refresh_token_ciphertext,calendar_id) values('encrypted-test','test-calendar');
 if (select auto_sync from public.google_calendar_connection) then raise exception 'Sync must default off'; end if;
 insert into public.schedule_periods(name,status) values('Calendar enabled','drafting') returning id into p;
 update public.google_calendar_connection set auto_sync=true;
 update public.schedule_periods set status='published' where id=p;
 if (select count(*) from public.google_calendar_jobs where period_id=p)<>1 then raise exception 'Missing publication job'; end if;
 update public.schedule_periods set status='locked' where id=p;
 if (select count(*) from public.google_calendar_jobs where period_id=p)<>1 then raise exception 'Duplicate job'; end if;
 if has_table_privilege('authenticated','public.google_calendar_connection','select') then raise exception 'Token exposed'; end if;
 if has_function_privilege('authenticated','public.claim_google_calendar_job(uuid)','execute') then raise exception 'Worker exposed'; end if;
end $$;
rollback;
