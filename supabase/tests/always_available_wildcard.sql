begin;
do $$declare actor uuid;pid uuid;sid uuid;shiftid uuid;begin
 select id into actor from public.profiles where app_role='admin' limit 1;
 select id into pid from public.schedule_periods where status='drafting' limit 1;
 select id into shiftid from public.shifts where period_id=pid limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 begin perform public.assign_wildcard_cover(pid,shiftid,null,25,false);raise exception 'Missing qualification accepted';exception when sqlstate 'P0001' then if sqlerrm='Missing qualification accepted' then raise;end if;end;
 sid:=public.assign_wildcard_cover(pid,shiftid,null,25,true);
 if not exists(select 1 from public.staff_members where id=sid and full_name='Patrick' and hourly_rate=25 and is_wildcard_fill_in) then raise exception 'Wildcard setup not retained';end if;
 if exists(select 1 from public.availability_submissions where staff_id=sid) then raise exception 'Wildcard unnecessarily requires a submission';end if;
 if not exists(select 1 from public.shift_assignments where staff_id=sid and shift_id=shiftid and status='assigned') then raise exception 'Wildcard assignment missing';end if;
 begin perform public.assign_wildcard_cover(pid,shiftid,sid);raise exception 'Duplicate accepted';exception when sqlstate 'P0001' then if sqlerrm='Duplicate accepted' then raise;end if;end;
 if has_function_privilege('anon','public.assign_wildcard_cover(uuid,uuid,uuid,numeric,boolean)','execute') then raise exception 'Anonymous assignment exposed';end if;
end $$;
rollback;
