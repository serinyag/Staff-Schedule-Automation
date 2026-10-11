# Optional Google Calendar connection

The Publish schedule section contains a collapsed Google Calendar panel. Automatic sync defaults to off. Connecting/reconnecting Google resets the destination and disables sync. Saving a destination while off creates no events. Enabling sync applies to future publications only; an existing published schedule needs the explicit Sync published schedule action. Drafts and flexible previews never sync.

## One-time setup (required before connecting)

1. Enable Google Calendar API in the studio's Google Cloud project. Create a Web application OAuth client, configure consent and authorized users. During Google OAuth Testing, refresh tokens for these scopes can expire after seven days; use Google's production consent configuration before launching.
2. Register exactly `https://staff-schedule-automation-zogi.vercel.app/api/admin/calendar/callback` as an authorized redirect URI.
3. Store `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and a fresh `GOOGLE_CALENDAR_ENCRYPTION_KEY` (32 bytes represented by 64 hexadecimal characters) as server-only Production Vercel environment variables. Never paste secrets into chat or commit them. Keep the encryption key stable; changing it requires reconnecting Google.
4. Deploy after setting variables. A signed-in manager clicks Connect Google, approves Calendar events and read-only calendar-list access, then selects a calendar they can edit. Keep Automatically sync when published unchecked during testing. Use a separate test calendar for an end-to-end smoke test before enabling the real destination.

This implementation uses Google's official OAuth library, state plus PKCE and a ten-minute HttpOnly callback cookie. Refresh tokens are encrypted with AES-256-GCM. The two integration tables have RLS enabled, no authenticated/anonymous table grants, and service-role-only access. OAuth scopes allow access to calendars the connecting account can access; use a dedicated studio Google account if narrower account-level access is desired.

## Publication and recovery

Migration 032 inserts a durable outbox job in the publication transaction only when automatic sync is enabled. After successful app publication, a signed Vercel Queue callback syncs the job. A lost queue dispatch leaves the persisted queued job visible for manual retry. Calendar failure never rolls back or hides an already-published schedule.

The worker reads assigned, published records only. One event per staffed shift lists staff names and uses Europe/Amsterdam times (including overnight shifts); empty optional shifts create no events. Events have no attendees and no guest invitations. No pay rates, availability, contracts, or manager notes are exported. Stable event IDs and ownership metadata allow safe retries without duplicate events; updates are restricted to the app's own matching events. Other calendar events are untouched. Five attempts, bounded execution time, exclusive expiring leases, and a manager retry control handle transient failures.

Pause stops pending jobs before further writes, although an already-issued Google request can finish. Previously-created events remain. Changing destination does not backfill or remove events from the old calendar. Automatic synchronization of later edits/deletions to already-published schedules is outside this version; the integration mirrors the published snapshot. Refresh status shows progress or a safe error message. Reconnect after token revocation/expiration. Do not enable real-calendar sync until the studio has completed testing.

Validation includes stable event IDs, overnight/DST time-zone handling, year-end all-day events, no empty-shift events, default-off behavior, publication-only enqueueing, duplicate enqueue prevention and token/worker permissions. A live Google write cannot be tested until OAuth credentials and a test calendar are configured.

References: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [event insertion and IDs](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
