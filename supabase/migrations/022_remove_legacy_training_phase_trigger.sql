-- Removes the legacy event-gated training-phase trigger.
-- The staff editor now saves training phase changes through
-- public.update_staff_admin_record(...), which is the source of truth.

drop trigger if exists validate_training_phase_change
on public.staff_training_status;

drop function if exists public.validate_training_phase_change();
