# Demo accounts

These are throwaway credentials for a local/demo Supabase project holding only
synthetic data. They are committed on purpose so the demo is reproducible. **Never
reuse this password anywhere real, and do not point this file at a project that
holds anything but seeded demo data.**

## Why you register these by hand

Auth users cannot be created from SQL. Creating one needs the Admin API and a
service-role key, and this project deliberately has none (`requirement.md` §9.2,
`CLAUDE.md` → Security rules). So the accounts are created through `/register`,
which is also what populates `public.profiles` via the `on_auth_user_created`
trigger. Everything *after* the accounts — rosters, logs, handovers, review
history — is seeded from SQL.

## Register these, in this order

Order matters. `seed_assignments.sql` ranks operators by `created_at`, so
registering Dana before Kofi is what makes the rosters below predictable.

| # | Email | Password | Display name | Role |
|---|---|---|---|---|
| 1 | `sam.rivera@example.com` | `ShiftDemo2026!` | Sam Rivera | supervisor |
| 2 | `dana.olsen@example.com` | `ShiftDemo2026!` | Dana Olsen | operator |
| 3 | `kofi.mensah@example.com` | `ShiftDemo2026!` | Kofi Mensah | operator |

`@example.com` is reserved by RFC 2606 and cannot receive mail, so these accounts
can never trigger a real delivery even by accident. The password is 14 characters,
comfortably over the 8-character minimum the register form enforces.

## If you want to demo the email confirmation round trip

`@example.com` addresses cannot receive the confirmation link. To show that flow
(FR-1.5), register **one extra account using an inbox you actually control**, and
before you do:

1. Turn **Confirm email** ON in Supabase → Authentication → Providers → Email.
2. Add `http://localhost:3000/confirm` to Supabase → Authentication → URL
   Configuration → Redirect URLs, or the emailed link will bounce.

Turn the toggle back off afterwards if you want the remaining accounts to stay
instant. The register flow handles both modes with no code change.

## What each login shows

After you have run `seed_assignments.sql` and `seed_demo_data.sql`, the demo week
is staged at **Terminal 2** on Monday and Tuesday:

**Sam Rivera (supervisor)** — sees the whole week, and a review queue with
Monday Evening's handover waiting. Monday Night has already been returned for
revision with written feedback, so the "request revision" half of FR-7 is visible
without doing anything first.

**Dana Olsen and Kofi Mensah (operators)** — one of them authored Monday Morning's
published handover; the other is rostered on Monday Evening and can read that
published handover from the calendar, which is FR-4.4 working. Which operator gets
which slot depends on registration order, so check the calendar rather than
assuming.

**Tuesday Morning** has 16 log entries — 2 critical, 2 warning, 12 info — and
deliberately **no handover yet**. That is the shift to demo `Create handover` on,
and once M4 lands it is the FR-6.8 acceptance case: both criticals must survive
individually while the twelve info entries get condensed.

## Resetting between demo runs

To re-stage without touching accounts:

```sql
delete from public.notifications;
delete from public.handover_reviews;
delete from public.handovers;
delete from public.log_entries;
```

Then re-run `seed_demo_data.sql`. It is guarded, so a second run over existing
data is a no-op rather than a duplicate.
