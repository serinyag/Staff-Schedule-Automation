begin;
-- Manual wildcard cover is independent of older saved availability rows.
create or replace function public.edit_schedule_assignment(p_period_id uuid,p_action text,p_shift_id uuid default null,p_staff_id uuid default null,p_assignment_id uuid default null)
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
 if not exists(select 1 from public.staff_members where id=staff and is_wildcard_fill_in) and exists(select 1 from public.availability_submissions sub join public.availability_days d on d.submission_id=sub.id
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
commit;
