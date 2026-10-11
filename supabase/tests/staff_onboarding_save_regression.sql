-- Exercise update + training/portal upserts as an authorized manager.
-- All data changes, including audit records, are rolled back. No email is sent.
begin;
select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles
  where is_active and app_role = 'admin' order by id limit 1
), true);
do $$
declare
  s public.staff_members%rowtype;
  c public.employment_contracts%rowtype;
  t public.staff_training_status%rowtype;
  result record;
begin
  select staff.* into strict s from public.staff_members staff
  where staff.id = '44d2b853-18b1-46e1-928f-d3f0321bea6a';
  select contract.* into strict c from public.employment_contracts contract
  where contract.staff_id = s.id order by contract.start_date desc limit 1;
  select training.* into strict t from public.staff_training_status training where training.staff_id = s.id;
  for i in 1..2 loop
    select * into strict result from public.admin_upsert_staff_onboarding(
      p_existing_staff_id => s.id,
      p_full_name => s.full_name,
      p_email => 'onboarding-regression@example.invalid',
      p_app_role => 'staff', p_login_access_enabled => false,
      p_scheduling_is_active => s.is_active,
      p_work_role => s.work_role, p_scheduling_rule_role => s.scheduling_rule_role,
      p_hourly_rate => s.hourly_rate, p_is_wildcard_fill_in => s.is_wildcard_fill_in,
      p_min_shifts_per_week => c.min_shifts_per_week,
      p_target_shifts_per_week => c.target_shifts_per_week,
      p_max_shifts_per_week => c.max_shifts_per_week,
      p_standard_shift_hours => c.standard_shift_hours,
      p_contract_start_date => c.start_date, p_contract_end_date => c.end_date,
      p_training_phase => t.phase, p_training_started_on => t.training_started_on,
      p_phase_started_on => t.phase_started_on, p_target_completion_on => t.target_completion_on,
      p_opening_training_completed_on => t.opening_training_completed_on,
      p_closing_training_completed_on => t.fully_trained_on,
      p_contract_notes => c.notes, p_training_notes => t.notes
    );
    assert result.staff_id = s.id, 'Save returned the wrong staff member';
    assert exists(select 1 from public.staff_portal_accounts where staff_id=s.id and normalized_email='onboarding-regression@example.invalid'), 'Portal upsert did not persist inside the transaction';
  end loop;
end;
$$;
rollback;
select 'PASS: existing staff saved twice; training and portal upserts succeeded; all test changes rolled back' as regression_result;
