create type public.staff_invitation_status as enum (
  'not_invited',
  'invitation_pending',
  'invitation_failed',
  'linked_existing_user'
);

create table public.staff_portal_accounts (
  staff_id uuid primary key references public.staff_members(id) on delete restrict,
  email text not null,
  normalized_email text not null,
  app_role public.app_role not null default 'staff',
  login_access_enabled boolean not null default true,
  auth_user_id uuid unique null,
  invitation_status public.staff_invitation_status not null default 'not_invited',
  invitation_sent_at timestamptz null,
  invitation_last_error text null,
  last_linked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_portal_accounts_email_not_blank check (btrim(email) <> ''),
  constraint staff_portal_accounts_normalized_email_check check (
    normalized_email = lower(btrim(normalized_email))
    and normalized_email <> ''
  )
);

create unique index staff_portal_accounts_normalized_email_idx
  on public.staff_portal_accounts (normalized_email);

create index staff_portal_accounts_auth_user_id_idx
  on public.staff_portal_accounts (auth_user_id);

create trigger set_staff_portal_accounts_updated_at
before update on public.staff_portal_accounts
for each row
execute function public.set_updated_at();

comment on table public.staff_portal_accounts is
  'Manager-controlled portal access metadata for staff onboarding, invitations, and profile linking.';

comment on column public.staff_portal_accounts.login_access_enabled is
  'Whether the linked application profile should be active for login once the auth user is connected.';

comment on column public.staff_portal_accounts.invitation_status is
  'Invitation lifecycle only. Overall onboarding state is derived from portal, profile, contract, training, and scheduling data together.';

create table public.staff_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  actor_profile_id uuid null references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index staff_admin_audit_log_staff_id_created_at_idx
  on public.staff_admin_audit_log (staff_id, created_at desc);

comment on table public.staff_admin_audit_log is
  'Append-only audit trail for manager/admin staff onboarding, access, and scheduling administration events.';

alter table public.staff_portal_accounts enable row level security;
alter table public.staff_admin_audit_log enable row level security;

create policy "Managers and admins can view staff portal accounts"
on public.staff_portal_accounts
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active is true
      and profile.app_role in ('admin', 'manager')
  )
);

create policy "Managers and admins can view staff admin audit log"
on public.staff_admin_audit_log
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active is true
      and profile.app_role in ('admin', 'manager')
  )
);

create or replace function public.admin_upsert_staff_onboarding(
  p_existing_staff_id uuid default null,
  p_full_name text default null,
  p_email text default null,
  p_app_role public.app_role default 'staff',
  p_login_access_enabled boolean default true,
  p_scheduling_is_active boolean default true,
  p_work_role public.work_role default null,
  p_scheduling_rule_role public.work_role default null,
  p_hourly_rate numeric default null,
  p_is_wildcard_fill_in boolean default false,
  p_min_shifts_per_week numeric default null,
  p_target_shifts_per_week numeric default null,
  p_max_shifts_per_week numeric default null,
  p_standard_shift_hours numeric default null,
  p_contract_start_date date default null,
  p_contract_end_date date default null,
  p_training_phase public.training_phase default null,
  p_training_started_on date default null,
  p_phase_started_on date default null,
  p_target_completion_on date default null,
  p_opening_training_completed_on date default null,
  p_closing_training_completed_on date default null,
  p_contract_notes text default null,
  p_training_notes text default null,
  p_existing_auth_user_id uuid default null
)
returns table(
  staff_id uuid,
  portal_email text,
  normalized_email text,
  auth_user_id uuid,
  profile_id uuid,
  onboarding_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile public.profiles%rowtype;
  v_email_normalized text;
  v_resolved_staff_id uuid;
  v_existing_staff public.staff_members%rowtype;
  v_existing_portal public.staff_portal_accounts%rowtype;
  v_existing_staff_by_email uuid;
  v_existing_contract_id uuid;
  v_conflicting_contract_id uuid;
  v_resolved_phase_started_on date;
  v_portal_status public.staff_invitation_status;
begin
  select profile.*
    into v_actor_profile
  from public.profiles profile
  where profile.id = (select auth.uid());

  if v_actor_profile.id is null
     or v_actor_profile.is_active is distinct from true
     or v_actor_profile.app_role not in ('admin', 'manager') then
    raise exception 'You do not have permission to manage staff onboarding.'
      using errcode = '42501';
  end if;

  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'Full name is required.'
      using errcode = 'P0001';
  end if;

  if p_email is null or btrim(p_email) = '' then
    raise exception 'Email is required.'
      using errcode = 'P0001';
  end if;

  v_email_normalized := lower(btrim(p_email));

  if position('@' in v_email_normalized) < 2 then
    raise exception 'A valid email is required.'
      using errcode = 'P0001';
  end if;

  if p_work_role is null then
    raise exception 'Work role is required.'
      using errcode = 'P0001';
  end if;

  if p_scheduling_rule_role is null then
    raise exception 'Scheduling rule role is required.'
      using errcode = 'P0001';
  end if;

  if p_min_shifts_per_week is null or p_min_shifts_per_week < 0 then
    raise exception 'Minimum shifts per week must be 0 or greater.'
      using errcode = 'P0001';
  end if;

  if p_target_shifts_per_week is null or p_target_shifts_per_week < p_min_shifts_per_week then
    raise exception 'Target shifts per week must be at least the minimum.'
      using errcode = 'P0001';
  end if;

  if p_max_shifts_per_week is not null and p_max_shifts_per_week < p_target_shifts_per_week then
    raise exception 'Maximum shifts per week must be empty or at least the target.'
      using errcode = 'P0001';
  end if;

  if p_standard_shift_hours is null or p_standard_shift_hours <= 0 then
    raise exception 'Standard shift hours must be greater than 0.'
      using errcode = 'P0001';
  end if;

  if p_hourly_rate is not null and p_hourly_rate < 0 then
    raise exception 'Hourly rate must be 0 or greater.'
      using errcode = 'P0001';
  end if;

  if p_contract_start_date is null then
    raise exception 'Contract start date is required.'
      using errcode = 'P0001';
  end if;

  if p_contract_end_date is not null and p_contract_end_date < p_contract_start_date then
    raise exception 'Contract end date must be on or after the contract start date.'
      using errcode = 'P0001';
  end if;

  if p_training_phase is null then
    raise exception 'Training phase is required.'
      using errcode = 'P0001';
  end if;

  if p_training_started_on is null then
    raise exception 'Training started date is required.'
      using errcode = 'P0001';
  end if;

  if p_training_phase = 'phase_2_opening_independent'
     and p_opening_training_completed_on is null then
    raise exception 'Opening training completion is required for Phase 2.'
      using errcode = 'P0001';
  end if;

  if p_training_phase = 'phase_3_fully_trained'
     and p_opening_training_completed_on is null then
    raise exception 'Opening training completion is required for Phase 3.'
      using errcode = 'P0001';
  end if;

  if p_training_phase = 'phase_3_fully_trained'
     and p_closing_training_completed_on is null then
    raise exception 'Closing training completion is required for Phase 3.'
      using errcode = 'P0001';
  end if;

  select portal.*
    into v_existing_portal
  from public.staff_portal_accounts portal
  where portal.normalized_email = v_email_normalized
  for update;

  v_existing_staff_by_email := v_existing_portal.staff_id;

  if p_existing_staff_id is not null and v_existing_staff_by_email is not null
     and v_existing_staff_by_email <> p_existing_staff_id then
    raise exception 'Another staff member already uses this email address.'
      using errcode = '23505';
  end if;

  v_resolved_staff_id := coalesce(p_existing_staff_id, v_existing_staff_by_email);

  if v_resolved_staff_id is not null then
    select staff.*
      into v_existing_staff
    from public.staff_members staff
    where staff.id = v_resolved_staff_id
    for update;

    if v_existing_staff.id is null then
      raise exception 'Staff member not found.'
        using errcode = 'P0002';
    end if;

    if p_existing_auth_user_id is not null
       and v_existing_staff.profile_id is not null
       and v_existing_staff.profile_id <> p_existing_auth_user_id then
      raise exception 'This staff member is already linked to a different application profile.'
        using errcode = 'P0001';
    end if;

    update public.staff_members
    set profile_id = coalesce(p_existing_auth_user_id, profile_id),
        full_name = btrim(p_full_name),
        work_role = p_work_role,
        scheduling_rule_role = p_scheduling_rule_role,
        hourly_rate = p_hourly_rate,
        is_active = p_scheduling_is_active,
        is_wildcard_fill_in = p_is_wildcard_fill_in,
        updated_at = now()
    where id = v_resolved_staff_id;
  else
    insert into public.staff_members (
      profile_id,
      full_name,
      work_role,
      scheduling_rule_role,
      hourly_rate,
      is_active,
      is_wildcard_fill_in
    )
    values (
      p_existing_auth_user_id,
      btrim(p_full_name),
      p_work_role,
      p_scheduling_rule_role,
      p_hourly_rate,
      p_scheduling_is_active,
      p_is_wildcard_fill_in
    )
    returning id into v_resolved_staff_id;
  end if;

  select contract.id
    into v_existing_contract_id
  from public.employment_contracts contract
  where contract.staff_id = v_resolved_staff_id
    and contract.start_date = p_contract_start_date
  for update;

  if v_existing_contract_id is null then
    select contract.id
      into v_conflicting_contract_id
    from public.employment_contracts contract
    where contract.staff_id = v_resolved_staff_id
      and daterange(
        contract.start_date,
        coalesce(contract.end_date, 'infinity'::date),
        '[]'
      ) && daterange(
        p_contract_start_date,
        coalesce(p_contract_end_date, 'infinity'::date),
        '[]'
      )
    order by contract.start_date desc
    limit 1;

    if v_conflicting_contract_id is not null then
      raise exception 'This contract overlaps an existing contract for the same staff member.'
        using errcode = 'P0001';
    end if;

    insert into public.employment_contracts (
      staff_id,
      start_date,
      end_date,
      min_shifts_per_week,
      target_shifts_per_week,
      max_shifts_per_week,
      standard_shift_hours,
      notes
    )
    values (
      v_resolved_staff_id,
      p_contract_start_date,
      p_contract_end_date,
      p_min_shifts_per_week,
      p_target_shifts_per_week,
      p_max_shifts_per_week,
      p_standard_shift_hours,
      nullif(btrim(coalesce(p_contract_notes, '')), '')
    );
  else
    update public.employment_contracts
    set end_date = p_contract_end_date,
        min_shifts_per_week = p_min_shifts_per_week,
        target_shifts_per_week = p_target_shifts_per_week,
        max_shifts_per_week = p_max_shifts_per_week,
        standard_shift_hours = p_standard_shift_hours,
        notes = nullif(btrim(coalesce(p_contract_notes, '')), ''),
        updated_at = now()
    where id = v_existing_contract_id;
  end if;

  v_resolved_phase_started_on := coalesce(
    p_phase_started_on,
    case p_training_phase
      when 'phase_1_shadow_only' then p_training_started_on
      when 'phase_2_opening_independent' then coalesce(p_opening_training_completed_on, p_training_started_on)
      when 'phase_3_fully_trained' then coalesce(p_closing_training_completed_on, p_opening_training_completed_on, p_training_started_on)
    end
  );

  insert into public.staff_training_status (
    staff_id,
    phase,
    training_started_on,
    target_completion_on,
    phase_started_on,
    opening_training_completed_on,
    fully_trained_on,
    updated_by,
    notes
  )
  values (
    v_resolved_staff_id,
    p_training_phase,
    p_training_started_on,
    p_target_completion_on,
    v_resolved_phase_started_on,
    p_opening_training_completed_on,
    p_closing_training_completed_on,
    (select auth.uid()),
    nullif(btrim(coalesce(p_training_notes, '')), '')
  )
  on conflict (staff_id) do update
  set phase = excluded.phase,
      training_started_on = excluded.training_started_on,
      target_completion_on = excluded.target_completion_on,
      phase_started_on = excluded.phase_started_on,
      opening_training_completed_on = excluded.opening_training_completed_on,
      fully_trained_on = excluded.fully_trained_on,
      updated_by = excluded.updated_by,
      notes = excluded.notes,
      updated_at = now();

  v_portal_status := case
    when p_existing_auth_user_id is null then 'not_invited'::public.staff_invitation_status
    else 'linked_existing_user'::public.staff_invitation_status
  end;

  insert into public.staff_portal_accounts (
    staff_id,
    email,
    normalized_email,
    app_role,
    login_access_enabled,
    auth_user_id,
    invitation_status,
    invitation_sent_at,
    invitation_last_error,
    last_linked_at
  )
  values (
    v_resolved_staff_id,
    btrim(p_email),
    v_email_normalized,
    p_app_role,
    p_login_access_enabled,
    p_existing_auth_user_id,
    v_portal_status,
    case when v_portal_status = 'invitation_pending' then now() else null end,
    null,
    case when p_existing_auth_user_id is not null then now() else null end
  )
  on conflict (staff_id) do update
  set email = excluded.email,
      normalized_email = excluded.normalized_email,
      app_role = excluded.app_role,
      login_access_enabled = excluded.login_access_enabled,
      auth_user_id = coalesce(excluded.auth_user_id, public.staff_portal_accounts.auth_user_id),
      invitation_status = case
        when excluded.auth_user_id is not null then 'linked_existing_user'::public.staff_invitation_status
        else public.staff_portal_accounts.invitation_status
      end,
      invitation_last_error = null,
      last_linked_at = case
        when excluded.auth_user_id is not null then now()
        else public.staff_portal_accounts.last_linked_at
      end,
      updated_at = now();

  if p_existing_auth_user_id is not null then
    insert into public.profiles (
      id,
      app_role,
      is_active
    )
    values (
      p_existing_auth_user_id,
      p_app_role,
      p_login_access_enabled
    )
    on conflict (id) do update
    set app_role = excluded.app_role,
        is_active = excluded.is_active,
        updated_at = now();

    update public.staff_members
    set profile_id = p_existing_auth_user_id,
        updated_at = now()
    where id = v_resolved_staff_id;
  end if;

  insert into public.staff_admin_audit_log (
    staff_id,
    actor_profile_id,
    action,
    details
  )
  values (
    v_resolved_staff_id,
    v_actor_profile.id,
    case when p_existing_staff_id is null and v_existing_staff_by_email is null then 'staff_onboarding_created' else 'staff_onboarding_updated' end,
    jsonb_build_object(
      'email', btrim(p_email),
      'normalized_email', v_email_normalized,
      'app_role', p_app_role,
      'login_access_enabled', p_login_access_enabled,
      'scheduling_is_active', p_scheduling_is_active,
      'work_role', p_work_role,
      'scheduling_rule_role', p_scheduling_rule_role,
      'training_phase', p_training_phase,
      'contract_start_date', p_contract_start_date,
      'contract_end_date', p_contract_end_date,
      'auth_user_id', p_existing_auth_user_id
    )
  );

  return query
  select
    v_resolved_staff_id,
    btrim(p_email),
    v_email_normalized,
    p_existing_auth_user_id,
    p_existing_auth_user_id,
    case
      when not p_login_access_enabled and not p_scheduling_is_active then 'deactivated'
      when not p_login_access_enabled then 'login_inactive'
      when p_existing_auth_user_id is null then 'ready_to_invite'
      when not p_scheduling_is_active then 'scheduling_inactive'
      else 'active'
    end;
end;
$$;

create or replace function public.admin_set_staff_portal_access(
  p_staff_id uuid,
  p_email text,
  p_app_role public.app_role,
  p_login_access_enabled boolean,
  p_auth_user_id uuid default null,
  p_invitation_status public.staff_invitation_status default null,
  p_invitation_last_error text default null
)
returns public.staff_portal_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_profile public.profiles%rowtype;
  v_staff public.staff_members%rowtype;
  v_portal public.staff_portal_accounts%rowtype;
  v_email_normalized text;
begin
  select profile.*
    into v_actor_profile
  from public.profiles profile
  where profile.id = (select auth.uid());

  if v_actor_profile.id is null
     or v_actor_profile.is_active is distinct from true
     or v_actor_profile.app_role not in ('admin', 'manager') then
    raise exception 'You do not have permission to manage staff portal access.'
      using errcode = '42501';
  end if;

  if p_staff_id is null then
    raise exception 'Staff id is required.'
      using errcode = 'P0001';
  end if;

  if p_email is null or btrim(p_email) = '' then
    raise exception 'Email is required.'
      using errcode = 'P0001';
  end if;

  select staff.*
    into v_staff
  from public.staff_members staff
  where staff.id = p_staff_id
  for update;

  if v_staff.id is null then
    raise exception 'Staff member not found.'
      using errcode = 'P0002';
  end if;

  v_email_normalized := lower(btrim(p_email));

  if position('@' in v_email_normalized) < 2 then
    raise exception 'A valid email is required.'
      using errcode = 'P0001';
  end if;

  insert into public.staff_portal_accounts (
    staff_id,
    email,
    normalized_email,
    app_role,
    login_access_enabled,
    auth_user_id,
    invitation_status,
    invitation_sent_at,
    invitation_last_error,
    last_linked_at
  )
  values (
    p_staff_id,
    btrim(p_email),
    v_email_normalized,
    p_app_role,
    p_login_access_enabled,
    p_auth_user_id,
    coalesce(
      p_invitation_status,
      case
        when p_auth_user_id is not null then 'linked_existing_user'::public.staff_invitation_status
        else 'not_invited'::public.staff_invitation_status
      end
    ),
    case
      when coalesce(p_invitation_status, 'not_invited'::public.staff_invitation_status) = 'invitation_pending'
        then now()
      else null
    end,
    nullif(btrim(coalesce(p_invitation_last_error, '')), ''),
    case when p_auth_user_id is not null then now() else null end
  )
  on conflict (staff_id) do update
  set email = excluded.email,
      normalized_email = excluded.normalized_email,
      app_role = excluded.app_role,
      login_access_enabled = excluded.login_access_enabled,
      auth_user_id = coalesce(excluded.auth_user_id, public.staff_portal_accounts.auth_user_id),
      invitation_status = coalesce(excluded.invitation_status, public.staff_portal_accounts.invitation_status),
      invitation_sent_at = case
        when coalesce(excluded.invitation_status, public.staff_portal_accounts.invitation_status) = 'invitation_pending'
          then now()
        else public.staff_portal_accounts.invitation_sent_at
      end,
      invitation_last_error = excluded.invitation_last_error,
      last_linked_at = case
        when coalesce(excluded.auth_user_id, public.staff_portal_accounts.auth_user_id) is not null
          then now()
        else public.staff_portal_accounts.last_linked_at
      end,
      updated_at = now()
  returning * into v_portal;

  if coalesce(p_auth_user_id, v_portal.auth_user_id) is not null then
    insert into public.profiles (
      id,
      app_role,
      is_active
    )
    values (
      coalesce(p_auth_user_id, v_portal.auth_user_id),
      p_app_role,
      p_login_access_enabled
    )
    on conflict (id) do update
    set app_role = excluded.app_role,
        is_active = excluded.is_active,
        updated_at = now();

    update public.staff_members
    set profile_id = coalesce(p_auth_user_id, v_portal.auth_user_id),
        updated_at = now()
    where id = p_staff_id;
  end if;

  insert into public.staff_admin_audit_log (
    staff_id,
    actor_profile_id,
    action,
    details
  )
  values (
    p_staff_id,
    v_actor_profile.id,
    'staff_portal_access_updated',
    jsonb_build_object(
      'email', btrim(p_email),
      'normalized_email', v_email_normalized,
      'app_role', p_app_role,
      'login_access_enabled', p_login_access_enabled,
      'auth_user_id', coalesce(p_auth_user_id, v_portal.auth_user_id),
      'invitation_status', coalesce(p_invitation_status, v_portal.invitation_status),
      'invitation_last_error', nullif(btrim(coalesce(p_invitation_last_error, '')), '')
    )
  );

  return v_portal;
end;
$$;

revoke all on function public.admin_upsert_staff_onboarding(
  uuid,
  text,
  text,
  public.app_role,
  boolean,
  boolean,
  public.work_role,
  public.work_role,
  numeric,
  boolean,
  numeric,
  numeric,
  numeric,
  numeric,
  date,
  date,
  public.training_phase,
  date,
  date,
  date,
  date,
  date,
  text,
  text,
  uuid
) from public;

grant execute on function public.admin_upsert_staff_onboarding(
  uuid,
  text,
  text,
  public.app_role,
  boolean,
  boolean,
  public.work_role,
  public.work_role,
  numeric,
  boolean,
  numeric,
  numeric,
  numeric,
  numeric,
  date,
  date,
  public.training_phase,
  date,
  date,
  date,
  date,
  date,
  text,
  text,
  uuid
) to authenticated;

revoke all on function public.admin_set_staff_portal_access(
  uuid,
  text,
  public.app_role,
  boolean,
  uuid,
  public.staff_invitation_status,
  text
) from public;

grant execute on function public.admin_set_staff_portal_access(
  uuid,
  text,
  public.app_role,
  boolean,
  uuid,
  public.staff_invitation_status,
  text
) to authenticated;
