# Shift Handover System — Requirements

Status: Draft v1 · Owner: Alyssa · Last updated: 2026-09-09

## 1. Purpose

Operations teams in 24/7 public-service settings (airport terminal ops, hospital
wards) hand over between shifts today using paper notebooks, whiteboards and
free-text chat. Information is lost at the boundary, severity is not consistently
communicated, and nobody can prove what was known when.

This system replaces that with a structured shift log and a reviewed handover
document:

- **Time saving** — an operator drafts the handover from the logs they already
  captured, optionally with AI assistance, instead of retyping the shift from memory.
- **Less manual work** — logs are collected in one place for the handover, and the
  next shift is notified automatically.
- **Quality and reliability** — a supervisor reviews every handover before it is
  published, and can send it back for revision.
- **Security** — every row is protected by Postgres Row Level Security, so a user
  can only ever read or write what their role and shift assignment permit.
- **Collaboration** — the incoming shift sees the outgoing shift's published
  handover in one place, on a calendar, before they start.

This is a **demo system**. Scope is deliberately narrow (§4). Prefer the simplest
implementation that satisfies the acceptance criteria.

## 2. Personas and roles

| Role | Who | Core need |
|---|---|---|
| **Operator** | Terminal duty officer / ward nurse | Record what happened during my shift, hand it over cleanly, see what the previous shift left me |
| **Supervisor** | Duty manager / charge nurse | Assure the quality of every handover before it reaches the next shift |

Exactly two roles are in scope. Role is stored on the user's profile and is assigned
at registration (demo: a role picker on the sign-up form). There is no admin UI for
role management and no self-service role change.

## 3. Glossary

- **Shift** — a named time slot at a location, e.g. "Terminal 2 — Night, 2026-09-09 22:00–06:00".
- **Assignment** — the link between a user and a shift they are rostered on.
- **Log entry** — a timestamped note recorded during a shift, with a severity.
- **Handover** — one document per shift, authored by an operator, that closes the shift.
- **Published** — a handover a supervisor has approved. Publication is the event that
  notifies the next shift. "Approved" and "published" are the same state.

## 4. Scope

### In scope

1. Email + password registration and login via Supabase Auth.
2. Operator and supervisor roles, enforced in the database with RLS.
3. Shift calendar as the landing view after login.
4. Shift log entries with severity levels.
5. Handover creation, AI-assisted drafting, submission, supervisor review
   (approve / request revision), and publication.
6. In-app notifications to the next shift on publication.

### Out of scope (explicitly not built)

- Email, SMS or push notifications of any kind. In-app only.
- Roster management UI, shift swapping, leave, or overtime.
- File or photo attachments on logs and handovers.
- Org hierarchy, multi-tenancy, departments, or more than the two roles.
- Audit-log export, retention policy, e-signature, or regulatory compliance features.
- Offline support, native mobile apps, and internationalisation.
- Any admin or service-role backend. See §9.2.

## 5. User journeys

### 5.1 Operator — run a shift

1. Logs in, lands on the **shift calendar** (§6, FR-4).
2. Sees their own upcoming and past shifts, and — attached to their shift slots — the
   published handovers from the shift immediately before theirs.
3. Opens their current shift and adds log entries as events occur, each with a
   severity and free-text content.
4. At the end of the shift, clicks **Create handover**. The handover editor opens with
   the shift's log entries listed alongside for reference.
5. Optionally clicks **Draft with AI** to generate a summary from the shift's logs,
   then edits it freely.
6. Clicks **Submit for review**. The handover becomes read-only to them.
7. If the supervisor requests revision, the handover returns to an editable state with
   the supervisor's feedback shown; the operator revises and resubmits.

### 5.2 Supervisor — review

1. Logs in, lands on the calendar; a **review queue** shows handovers awaiting review.
2. Opens a submitted handover and reads it alongside the underlying shift log entries.
3. Either **approves** it — which publishes it and notifies the next shift — or
   **requests revision** with written feedback, which returns it to the operator.

### 5.3 Incoming operator — receive

1. Logs in and sees an in-app notification that a handover has been published for the
   shift preceding theirs.
2. Clicks through to read the published handover and its source log entries.

## 6. Functional requirements

Each requirement is written so it can be tested. `MUST` is binding.

### FR-1 — Authentication

- **FR-1.1** Users MUST register with email and password through Supabase Auth.
- **FR-1.2** Registration MUST capture a display name and a role (`operator` or
  `supervisor`) and create a matching `profiles` row.
- **FR-1.3** Unauthenticated users MUST be redirected to `/login` for any route other
  than `/login` and `/register`.
- **FR-1.4** Session refresh MUST happen in `proxy.ts` (see CLAUDE.md, "Next.js 16")
  so server components always see a valid session.
- **FR-1.5** Email confirmation is **off during development**, so accounts are usable
  immediately and no mail is sent while building. It **MAY be switched on** in the Supabase
  project for the live demo, to show the real email auth round trip. The register flow MUST
  support both modes **without a code change**: if `signUp` returns a session, redirect to
  the calendar; if it returns none, show a "check your inbox to confirm" state rather than
  appearing to fail, and let the emailed link land on the `/confirm` callback, which
  exchanges the token for a session. The application itself never sends email; the
  confirmation mail is sent by Supabase Auth.

**Acceptance:** a new user can register, is redirected to the calendar, and their
`profiles.role` matches what they selected.

### FR-2 — Roles and authorisation

- **FR-2.1** A user's role MUST be stored in `profiles.role` and MUST be enforced by
  RLS policies, not only by UI conditionals.
- **FR-2.2** Operators MUST NOT be able to read handovers or logs for shifts they are
  not assigned to. Supervisors MAY read all shifts, logs and handovers.
- **FR-2.3** Only supervisors MAY move a handover out of `submitted`.
- **FR-2.4** Route-level UI gating is a convenience only; every gate MUST have a
  corresponding RLS policy that makes bypassing the UI useless.

**Acceptance:** a test that authenticates as operator A and queries operator B's shift
logs returns zero rows, not an error page.

### FR-3 — Shift log entries

- **FR-3.1** An operator assigned to a shift MUST be able to create log entries on that
  shift while the shift's handover is not yet `submitted` or `approved`.
- **FR-3.2** Each entry MUST have a severity of `info`, `warning`, or `critical`, and
  non-empty content (1–2000 characters).
- **FR-3.3** Severity MUST be visually distinct in the list (colour plus a text label;
  colour MUST NOT be the only signal).
- **FR-3.4** Entries MUST be listed newest-first with author and timestamp.
- **FR-3.5** An author MAY edit or delete their own entry until the shift's handover is
  submitted. After submission, entries are immutable.

**Acceptance:** creating an entry with severity `critical` renders with the critical
styling and appears at the top of the shift's log list.

### FR-4 — Shift calendar

- **FR-4.1** The calendar MUST be the landing route after login (`/`).
- **FR-4.2** It MUST show a week view of shift slots. An operator sees the slots they
  are assigned to highlighted; a supervisor sees all slots.
- **FR-4.3** Each slot MUST show its status: no handover / draft / submitted / changes
  requested / published.
- **FR-4.4** An operator MUST be able to reach the published handover of the shift
  immediately preceding one of their own shifts from the calendar.
- **FR-4.5** Clicking a slot the user may open leads to the shift detail page (logs and
  handover).

**Acceptance:** an operator with one assigned night shift sees that slot highlighted and
can open the previous evening shift's published handover in one click.

### FR-5 — Handover authoring

- **FR-5.1** Exactly one handover MUST exist per shift, enforced by a unique constraint
  on `handovers.shift_id`.
- **FR-5.2** An assigned operator MUST be able to create a handover for their shift.
  Creation is an explicit user action, never automatic.
- **FR-5.3** Handover states MUST be `draft` → `submitted` → (`approved` |
  `changes_requested` → `submitted` → …).
- **FR-5.4** Content is free text (plain text is sufficient), 1–20000 characters,
  required to be non-empty at submission.
- **FR-5.5** The editor MUST show the shift's log entries beside the content field so
  the operator can reference them without navigating away.
- **FR-5.6** Once `submitted`, the handover MUST be read-only to the operator until a
  supervisor requests revision.

**Acceptance:** a second attempt to create a handover on the same shift fails at the
database level, not only in the UI.

### FR-6 — AI-assisted drafting

- **FR-6.1** In the handover editor, the operator MAY click **Draft with AI** to
  generate a proposed handover from that shift's log entries.
- **FR-6.2** The generated text MUST land in the editable content field. It MUST NOT be
  submitted automatically and MUST be fully editable.
- **FR-6.3** The model call MUST happen server-side only. The API key MUST NEVER be
  exposed to the browser or prefixed `NEXT_PUBLIC_`.
- **FR-6.4** The prompt MUST receive only the log entries of that one shift — severity,
  timestamp, author display name, content — and no other user's data.
- **FR-6.5** If the model call fails or times out, the editor MUST show a non-blocking
  error and leave any existing content untouched. AI is never on the critical path; the
  operator can always type the handover by hand.
- **FR-6.6** **No AI label is shown to the supervisor.** Once the operator has edited
  and submitted the handover, the operator owns the content, and the review UI presents
  it as the operator's work. An `ai_assisted` boolean is still recorded on the row for
  internal analytics and audit, and MUST NOT be rendered in the supervisor's review view.
- **FR-6.7** Provider and model: Anthropic Messages API, model `claude-sonnet-5`, via the
  official `@anthropic-ai/sdk`. A single non-streaming call is sufficient for this
  payload size.
- **FR-6.8** The draft MUST be weighted by severity, not a flat retelling of the shift:
  - `critical` entries are **incidents**. Each one is called out individually, near the
    top of the draft, with its time and what happened. None may be merged away or dropped.
  - `warning` entries get a brief line each.
  - `info` entries are condensed into a short summary. They are skimmed, not enumerated.

  The point is that the incoming shift sees what actually matters in the first few lines.

**Acceptance:** with `ANTHROPIC_API_KEY` unset, the editor still loads and the operator
can write and submit a handover manually; the AI button surfaces a clear error. Given a
shift with two `critical` and twelve `info` entries, both critical entries appear
individually in the draft and the twelve are summarised rather than listed.

### FR-7 — Supervisor review

- **FR-7.1** A supervisor MUST see a queue of handovers in `submitted` state.
- **FR-7.2** The review view MUST show the handover content and the shift's log entries.
- **FR-7.3** **Approve** sets the handover to `approved`, stamps `reviewed_by` and
  `reviewed_at`, and triggers notifications (FR-8).
- **FR-7.4** **Request revision** requires non-empty feedback, sets the state to
  `changes_requested`, stores the feedback, and notifies the authoring operator.
- **FR-7.5** Review feedback MUST be retained as a list, so a handover revised twice
  shows both rounds of feedback.
- **FR-7.6** A supervisor MUST NOT be able to edit handover content. Review is
  approve-or-return only.

**Acceptance:** approving a handover flips its state and creates one notification row
per member of the next shift; requesting revision creates exactly one notification for
the author.

### FR-8 — In-app notifications

- **FR-8.1** On publication, the system MUST create an in-app notification for every
  operator assigned to the **next shift** — the shift at the same location whose
  `starts_at` is the earliest one at or after the published shift's `ends_at`.
- **FR-8.2** Notifications MUST be created by a database trigger, not by client code, so
  that a client which skips the call cannot skip the notification. With no service-role
  key available (§9.2), a `SECURITY DEFINER` trigger is the only correct place for this.
- **FR-8.3** Notifications MUST appear without a page reload, via Supabase Realtime on
  the `notifications` table filtered to the current user.
- **FR-8.4** A bell in the app header MUST show an unread count; opening a notification
  marks it read and navigates to the relevant handover.
- **FR-8.5** A user MUST only ever be able to read and update their own notifications.
- **FR-8.6** No email, SMS or push is sent, in any environment, including tests.

**Acceptance:** with two browser sessions open, approving a handover in the supervisor
session increments the bell in the incoming operator's session without a reload.

## 7. Data model

Six tables in the `public` schema. All have `id uuid primary key default gen_random_uuid()`
and `created_at timestamptz not null default now()` unless noted.

```
profiles
  id           uuid pk  -> references auth.users(id) on delete cascade
  full_name    text not null
  role         user_role not null            -- enum: operator | supervisor

shifts
  location     text not null                 -- e.g. 'Terminal 2'
  name         text not null                 -- e.g. 'Night'
  starts_at    timestamptz not null
  ends_at      timestamptz not null
  check (ends_at > starts_at)

shift_assignments
  shift_id     uuid not null -> shifts(id) on delete cascade
  user_id      uuid not null -> profiles(id) on delete cascade
  unique (shift_id, user_id)

log_entries
  shift_id     uuid not null -> shifts(id) on delete cascade
  author_id    uuid not null -> profiles(id)
  severity     log_severity not null         -- enum: info | warning | critical
  content      text not null check (char_length(content) between 1 and 2000)

handovers
  shift_id     uuid not null unique -> shifts(id) on delete cascade
  author_id    uuid not null -> profiles(id)
  content      text not null default ''
  status       handover_status not null default 'draft'
                                             -- enum: draft | submitted | changes_requested | approved
  ai_assisted  boolean not null default false  -- internal only, never rendered (FR-6.6)
  submitted_at timestamptz
  reviewed_by  uuid -> profiles(id)
  reviewed_at  timestamptz
  updated_at   timestamptz not null default now()

handover_reviews
  handover_id  uuid not null -> handovers(id) on delete cascade
  reviewer_id  uuid not null -> profiles(id)
  decision     review_decision not null      -- enum: approved | changes_requested
  feedback     text                          -- required when decision = 'changes_requested'

notifications
  user_id      uuid not null -> profiles(id) on delete cascade
  handover_id  uuid -> handovers(id) on delete cascade
  kind         notification_kind not null    -- enum: handover_published | revision_requested
  message      text not null
  read_at      timestamptz
```

Seed data for the demo: two locations, a week of three shift slots per day
(Morning / Evening / Night), a handful of operators and one supervisor, and assignments
covering the current week.

## 8. RLS policy matrix

RLS is enabled on **every** table. There is no bypass path, because the app never holds
a service-role key (§9.2).

Role is resolved through `SECURITY DEFINER` helpers so that policies on `profiles` do
not recurse:

```sql
create function public.auth_role() returns user_role
  language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create function public.is_assigned(target_shift uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.shift_assignments
     where shift_id = target_shift and user_id = auth.uid()) $$;
```

A third helper, `is_incoming_for_shift(target_shift)`, returns true when the caller is
rostered on the shift immediately following the target shift at the same location. It
resolves "next shift" the same way the notification trigger does. Without it an incoming
operator would be notified about a published handover they could not then read, which
would make FR-4.4 and FR-8.4 unsatisfiable.

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `profiles` | any authenticated user (display names are needed throughout) | own row only (`id = auth.uid()`) | own row; `role` immutable | none |
| `shifts` | any authenticated user | supervisor | supervisor | supervisor |
| `shift_assignments` | any authenticated user | supervisor | supervisor | supervisor |
| `log_entries` | supervisor; operator assigned to the shift; operator rostered on the *next* shift at that location, once the handover is `approved` | operator assigned to the shift, and the shift's handover is not `submitted` or `approved` | own entry, same condition | own entry, same condition |
| `handovers` | supervisor; operator assigned to the shift; operator rostered on the *next* shift at that location, when `status = 'approved'` | operator assigned to the shift; status must be `draft` | author while status is `draft` or `changes_requested`; supervisor may change only `status`, `reviewed_by`, `reviewed_at` | none |
| `handover_reviews` | supervisor, or operator assigned to the reviewed handover's shift | supervisor only | none | none |
| `notifications` | own rows only (`user_id = auth.uid()`) | none from the client — trigger-inserted only | own rows, `read_at` only | own rows |

Notes:

- "Supervisor may change only status columns" is enforced with a `with check` clause plus
  a trigger that rejects content changes made by anyone other than the author.
- Notification inserts come from a `SECURITY DEFINER` trigger on `handovers` that fires
  on the transition into `approved` or `changes_requested`.
- The incoming shift's read access is deliberately narrow: the handover must be `approved`,
  so an operator never sees a neighbouring shift's draft or a handover still under review.
- `EXECUTE` on all `SECURITY DEFINER` helpers is revoked from `public`/`anon` and granted to
  `authenticated` only, since PostgREST exposes public-schema functions as RPC.

## 9. Non-functional requirements

### 9.1 Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16.3.4, App Router, TypeScript strict |
| UI | Tailwind CSS v4 |
| Auth / DB | Supabase (Auth, Postgres, RLS, Realtime) |
| AI | Anthropic Messages API, `claude-sonnet-5` |
| Hosting | Vercel (frontend and route handlers), Vercel CLI for local link and deploy |

### 9.2 Security

- **No service-role key anywhere.** Not in the app, not in CI, not in `.env.local`. The
  browser and the server both use the anon/publishable key and act as the signed-in user.
  Anything that must run with elevated rights is a `SECURITY DEFINER` Postgres function or
  trigger, reviewed as part of the migration.
- `.env.local` is git-ignored; `.env.example` is committed and lists every variable with a
  placeholder value.
- `ANTHROPIC_API_KEY` is server-only and MUST NOT carry the `NEXT_PUBLIC_` prefix.
- Every new table ships with RLS enabled in the same migration that creates it. A migration
  that adds a table without policies is a review failure.
- Handover and log content is user-authored text; render it as text, never as raw HTML.

### 9.3 Quality gates

Every change must pass, and CI enforces all four:

1. `npm run lint` (ESLint flat config) — clean.
2. `npm run typecheck` (`tsc --noEmit`) — clean.
3. `npm test` (unit tests) — green.
4. `npm run build` — succeeds.

Conventional Commits for commit messages. No pre-commit hook is installed for this project
by decision; the gates run in CI and are run manually before committing.

### 9.4 Performance and scale

Demo scale: tens of users, hundreds of log entries. No caching strategy, no pagination
beyond a sensible `limit` on list queries, and no load testing.

### 9.5 Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Anon/publishable key |
| `ANTHROPIC_API_KEY` | server only | AI handover drafting |

## 10. Milestones

| # | Milestone | Contents | Done when |
|---|---|---|---|
| M0 | Foundation | Supabase project, schema migration, enums, RLS policies, seed data, `.env.example` | Schema and RLS complete |
| M1 | Auth | Register / login / logout, `profiles` creation, `proxy.ts` session refresh, route protection | FR-1, FR-2 acceptance met |
| M2 | Calendar | Week view, assignment highlighting, slot status, link to previous handover | FR-4 acceptance met |
| M3 | Logs | Shift detail page, create / edit / delete entries, severity display | FR-3 acceptance met |
| M4 | Handover + review | Create, edit, submit, review queue, approve, request revision | FR-5, FR-7 acceptance met |
| M5 | AI + notifications | Draft-with-AI route, publication trigger, Realtime bell | FR-6, FR-8 acceptance met |
| M6 | Hardening | CI pipeline green, RLS test suite, Vercel deploy | All gates green |

Each milestone is implemented by the building agent and then checked by the review agent
before the next one starts (see CLAUDE.md, "Agent harness").

## 11. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Three severity levels: `info`, `warning`, `critical` | Enough to triage; more levels invite inconsistent use in a demo |
| D2 | Approval is publication; no separate publish step | Approval was described as the moment the handover becomes real |
| D3 | No AI label reaches the supervisor | Confirmed by the product owner: the operator edits and submits, so the operator owns the content. `ai_assisted` is kept for internal audit only |
| D4 | Anthropic Messages API with `claude-sonnet-5` | Summarising one shift's log entries is a modest task and Opus-tier cost is not justified for it. Only move up a tier if drafts measurably miss incidents |
| D4a | The AI draft is severity-weighted: incidents in full, the rest skimmed | A flat retelling buries the one thing the incoming shift needs to know (FR-6.8) |
| D5 | Notifications fan out via a `SECURITY DEFINER` trigger | With no service-role key, the database is the only place that can write rows on another user's behalf |
| D6 | One handover per shift, unique constraint | Matches the described flow and removes a class of ambiguity |
| D7 | No pre-commit hook | Explicit instruction; the gates run in CI |

## 12. Open questions

- Should a supervisor also be able to author log entries on shifts they cover? Assumed
  **no** for now; supervisors review only.
- Should the "next shift" for notification purposes be scoped by location only, or also by
  role or team? Assumed **location only** for the demo (FR-8.1).
- **Saving a revision passes back through `draft`.** FR-5.3 lists `changes_requested →
  submitted`, but the RLS policy `handovers_update_author` in `0001_init.sql` has
  `with check (status in ('draft','submitted'))`, so an author-written row can never come
  back out of an update still in `changes_requested`. An operator who saves a partial
  revision therefore moves `changes_requested → draft → submitted`. Nothing is lost — the
  supervisor's feedback lives in the append-only `handover_reviews` and stays on screen —
  but the intermediate `draft` is a state FR-5.3 does not name. Accept it, or drop the save
  button so the only way out of `changes_requested` is a resubmit?
