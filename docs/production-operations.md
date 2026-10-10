# Production operations

## Deploying

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, Python tests, `bash scripts/test-runtime-database.sh`, `npm audit --omit=dev --audit-level=high`, `pip-audit -r requirements.txt` and `npm run build`.

Before applying migration 029, run the migration and `supabase/tests/production_schedule_runtime.sql` in a single transaction ending in ROLLBACK on the linked database. This catches differences from the isolated fixture without altering schedules. Take a schema snapshot first. Create a staged production deployment with `vercel deploy --prod --skip-domain`, apply the verified migration, then promote the matching deployment. The runtime policy's engine version must match the deployed worker. Never promote an older writer after restricting its database privileges.

The current production alias is used for internal engine calls because per-deployment URLs can require Vercel Deployment Protection. A staged deployment is not a separate data environment. Use a separate Supabase project before staging writes or new business scenarios. Test migration transactions roll back; routine release checks do not regenerate or publish a manager's schedule.

## Generation failures

Find the run ID in `schedule_generation_runs` and in Vercel structured logs. `last_error_code`, `attempt_count`, lease expiry, saved input snapshot, result metadata and timestamps distinguish interrupted work from invalid inputs. Do not put tokens or full planning data into logs or support messages.

Queue redelivery and leases handle transient failures and crashes. Jobs with changed inputs stop rather than retrying against different data. The next manager page visit or queue action terminalizes jobs older than the one-hour delivery window. This is a fallback, not a separately scheduled watchdog. The queue and database still need monitoring for an exhausted delivery window or provider outage.

An ambiguous save timeout is safe: completing a job is atomic and an already completed run cannot subsequently be marked failed. Check saved state before retrying a manual action. Failed draft replacement rolls back; an unchanged snapshot allows a job retry.

## Recovery and remaining account-level checks

Verify Supabase backup retention and test restoration into a separate project before relying on recovery. This code change does not enable a paid backup plan, establish a restoration guarantee, or enable MFA on anyone's account. Administrators should enable MFA for Supabase, Vercel and GitHub. Verify live RLS and security advisors after migrations. Review production log retention and alerts in Vercel; structured logs alone do not create an alerting service.

Generation snapshots and validation/audit records contain private staff information and follow manager-only access. Define an appropriate retention period and test an archival process before removing history.

## Known development dependency advisory

After updating Next.js/React and compatible transitive dependencies, the production npm dependency audit is clean. The latest published `braces` 3.0.3 remains affected by GHSA-vfj7-8cjw-p6xm through Next's lint tooling. This is a development-only glob-processing dependency; lint processes repository-controlled patterns. Do not use it to evaluate untrusted patterns. There is no published patched version at the time of this change. Do not force-downgrade Next or hide the advisory; recheck when dependencies update.

## Release verification, 10 October 2026

Migration 029 passed its regression suite inside a rollback transaction on the live Supabase schema before application. The matching production release uses engine 0.8.0. A real August flexible preview (run `173f6d0b-12d7-4099-a63f-ca78f13bf684`) completed on its first attempt with no recorded error. The existing draft fingerprint stayed unchanged. The authenticated canonical recheck saved its findings and kept publication unavailable for the existing draft's outstanding issues. No schedule was published or replaced during verification.

Local validation passed 52 TypeScript tests, 96 Python tests, the transactional PostgreSQL suite, lint, type checking and the deployment build. Production dependency audits passed. Live profile policies allow staff to read their own profile; profile changes are manager-only, so staff cannot promote themselves through a direct profile update. This is a scoped review, not an external penetration test or a guarantee against all vulnerabilities.
