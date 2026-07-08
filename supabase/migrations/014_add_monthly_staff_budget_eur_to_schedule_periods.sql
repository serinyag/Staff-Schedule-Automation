alter table public.schedule_periods
add column if not exists monthly_staff_budget_eur numeric;
