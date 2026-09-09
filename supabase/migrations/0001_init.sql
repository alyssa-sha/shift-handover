-- =============================================================================
-- Shift Handover System - initial schema, RLS and triggers
--
-- requirement.md section 7 (data model), section 8 (RLS matrix), FR-8.1 / FR-8.2.
--
-- HOW TO RUN: paste this whole file into the Supabase dashboard SQL editor and
-- run it top to bottom. There is no local Postgres and no Docker in this
-- project, so `supabase db push` is not used. The file is written to be
-- re-runnable: every object is created with `if not exists` or `or replace`,
-- and every policy is dropped before it is recreated.
--
-- SECURITY: this project holds no service-role key (requirement.md section 9.2).
-- Everything the app does runs as the signed-in user under RLS. The only
-- elevated code is the SECURITY DEFINER helpers and triggers below, each with
-- `set search_path = public`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role' and typnamespace = 'public'::regnamespace) then
    create type public.user_role as enum ('operator', 'supervisor');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'log_severity' and typnamespace = 'public'::regnamespace) then
    create type public.log_severity as enum ('info', 'warning', 'critical');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'handover_status' and typnamespace = 'public'::regnamespace) then
    create type public.handover_status as enum ('draft', 'submitted', 'changes_requested', 'approved');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'review_decision' and typnamespace = 'public'::regnamespace) then
    create type public.review_decision as enum ('approved', 'changes_requested');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'notification_kind' and typnamespace = 'public'::regnamespace) then
    create type public.notification_kind as enum ('handover_published', 'revision_requested');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  role       public.user_role not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id         uuid primary key default gen_random_uuid(),
  location   text not null,
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now(),
  constraint shifts_ends_after_start check (ends_at > starts_at)
);

create index if not exists shifts_location_starts_at_idx
  on public.shifts (location, starts_at);

create table if not exists public.shift_assignments (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid not null references public.shifts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint shift_assignments_shift_user_key unique (shift_id, user_id)
);

create index if not exists shift_assignments_user_id_idx
  on public.shift_assignments (user_id);

create table if not exists public.log_entries (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid not null references public.shifts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id),
  severity   public.log_severity not null,
  content    text not null,
  created_at timestamptz not null default now(),
  constraint log_entries_content_length check (char_length(content) between 1 and 2000)
);

create index if not exists log_entries_shift_id_created_at_idx
  on public.log_entries (shift_id, created_at desc);

create table if not exists public.handovers (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null unique references public.shifts (id) on delete cascade,
  author_id    uuid not null references public.profiles (id),
  content      text not null default '',
  status       public.handover_status not null default 'draft',
  ai_assisted  boolean not null default false,
  submitted_at timestamptz,
  reviewed_by  uuid references public.profiles (id),
  reviewed_at  timestamptz,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint handovers_content_length check (char_length(content) <= 20000)
);

create index if not exists handovers_status_idx on public.handovers (status);

create table if not exists public.handover_reviews (
  id          uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id),
  decision    public.review_decision not null,
  feedback    text,
  created_at  timestamptz not null default now(),
  constraint handover_reviews_feedback_required check (
    decision <> 'changes_requested'
    or (feedback is not null and char_length(btrim(feedback)) > 0)
  )
);

create index if not exists handover_reviews_handover_id_idx
  on public.handover_reviews (handover_id, created_at);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  handover_id uuid references public.handovers (id) on delete cascade,
  kind        public.notification_kind not null,
  message     text not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 3. SECURITY DEFINER helpers (requirement.md section 8)
--
-- auth_role() and is_assigned() are the two helpers the RLS matrix specifies.
-- handover_shift() and shift_handover_open() exist for the same reason: an RLS
-- policy that reads another RLS-protected table through a plain subquery is
-- filtered by that table's own policies, which either recurses or silently
-- under-matches. Both are read-only and take a single id.
-- -----------------------------------------------------------------------------

create or replace function public.auth_role() returns public.user_role
  language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_assigned(target_shift uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.shift_assignments
     where shift_id = target_shift and user_id = auth.uid()) $$;

-- The shift a handover belongs to, used by the handover_reviews policies.
create or replace function public.handover_shift(target_handover uuid) returns uuid
  language sql stable security definer set search_path = public as
$$ select shift_id from public.handovers where id = target_handover $$;

-- True while the shift's handover has not been submitted or approved, i.e.
-- while log entries on that shift are still mutable (FR-3.1, FR-3.5).
create or replace function public.shift_handover_open(target_shift uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select not exists (
     select 1 from public.handovers
     where shift_id = target_shift
       and status in ('submitted', 'approved')) $$;

-- -----------------------------------------------------------------------------
-- 4. Triggers
-- -----------------------------------------------------------------------------

-- 4.1 Profile creation on sign-up.
--
-- With no service-role key, and with Supabase email confirmation possibly ON
-- (signUp returns no session in that mode), the client cannot always insert its
-- own profiles row. This trigger reads the display name and role out of the
-- sign-up metadata, so registration works in both confirmation modes with no
-- code change (FR-1.2, FR-1.5).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  begin
    v_role := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'operator')::public.user_role;
  exception when others then
    v_role := 'operator';
  end;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4.2 profiles.role is immutable for end users (section 8: "own row; role
-- immutable"). auth.uid() is null in the SQL editor, so a role can still be
-- corrected by hand in the dashboard.
create or replace function public.profiles_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'profiles.id is immutable';
  end if;
  if auth.uid() is not null and new.role is distinct from old.role then
    raise exception 'profiles.role is immutable';
  end if;
  return new;
end $$;

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- 4.3 Handover column guard (section 8 note: "a trigger that rejects content
-- changes made by anyone other than the author"). Also keeps updated_at fresh.
create or replace function public.handovers_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();

  if new.shift_id is distinct from old.shift_id
     or new.author_id is distinct from old.author_id then
    raise exception 'handovers.shift_id and handovers.author_id are immutable';
  end if;

  -- Maintenance from the SQL editor has no auth.uid(); leave it alone.
  if auth.uid() is null then
    return new;
  end if;

  if auth.uid() <> old.author_id
     and (new.content is distinct from old.content
          or new.ai_assisted is distinct from old.ai_assisted) then
    raise exception 'only the handover author may change handover content';
  end if;

  return new;
end $$;

drop trigger if exists handovers_before_update on public.handovers;
create trigger handovers_before_update
  before update on public.handovers
  for each row execute function public.handovers_before_update();

-- 4.4 Notifications are read-receipt only for their owner (section 8:
-- "own rows, read_at only").
create or replace function public.notifications_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.user_id is distinct from old.user_id
     or new.handover_id is distinct from old.handover_id
     or new.kind is distinct from old.kind
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at then
    raise exception 'only notifications.read_at may be updated';
  end if;
  return new;
end $$;

drop trigger if exists notifications_before_update on public.notifications;
create trigger notifications_before_update
  before update on public.notifications
  for each row execute function public.notifications_before_update();

-- 4.5 Notification fan-out (FR-8.1, FR-8.2).
--
-- On the transition into `approved`: one notification per operator assigned to
-- the next shift, i.e. the shift at the same location whose starts_at is the
-- earliest one at or after this shift's ends_at. On the transition into
-- `changes_requested`: one notification for the handover's author.
--
-- SECURITY DEFINER because this writes rows owned by other users and the app
-- holds no service-role key (requirement.md section 9.2, decision D5).
create or replace function public.notify_on_handover_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location       text;
  v_name           text;
  v_starts_at      timestamptz;
  v_ends_at        timestamptz;
  v_next_starts_at timestamptz;
  v_message        text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  select s.location, s.name, s.starts_at, s.ends_at
    into v_location, v_name, v_starts_at, v_ends_at
    from public.shifts s
   where s.id = new.shift_id;

  if v_location is null then
    return new;
  end if;

  if new.status = 'approved' then
    select min(s.starts_at)
      into v_next_starts_at
      from public.shifts s
     where s.location = v_location
       and s.starts_at >= v_ends_at
       and s.id <> new.shift_id;

    if v_next_starts_at is null then
      return new;
    end if;

    v_message := format(
      'Handover published for %s %s (%s).',
      v_location, v_name, to_char(v_starts_at, 'YYYY-MM-DD HH24:MI')
    );

    insert into public.notifications (user_id, handover_id, kind, message)
    select distinct sa.user_id,
           new.id,
           'handover_published'::public.notification_kind,
           v_message
      from public.shifts s
      join public.shift_assignments sa on sa.shift_id = s.id
      join public.profiles p on p.id = sa.user_id
     where s.location = v_location
       and s.starts_at = v_next_starts_at
       and s.id <> new.shift_id
       and p.role = 'operator';

  elsif new.status = 'changes_requested' then
    v_message := format(
      'Revision requested on your handover for %s %s (%s).',
      v_location, v_name, to_char(v_starts_at, 'YYYY-MM-DD HH24:MI')
    );

    insert into public.notifications (user_id, handover_id, kind, message)
    values (new.author_id, new.id, 'revision_requested', v_message);
  end if;

  return new;
end $$;

drop trigger if exists handovers_notify_on_status_change on public.handovers;
create trigger handovers_notify_on_status_change
  after update on public.handovers
  for each row
  when (old.status is distinct from new.status)
  execute function public.notify_on_handover_status_change();

-- -----------------------------------------------------------------------------
-- 5. Row Level Security
--
-- Enabled on every table. requirement.md section 8 is the matrix; the policies
-- below are a one-to-one transcription of it.
-- -----------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.shifts            enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.log_entries       enable row level security;
alter table public.handovers         enable row level security;
alter table public.handover_reviews  enable row level security;
alter table public.notifications     enable row level security;

-- 5.1 profiles: read all (display names are needed throughout), write own row,
-- no deletes.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy: profile deletes are denied to every client.

-- 5.2 shifts: everyone reads, supervisors write.
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (true);

drop policy if exists shifts_insert_supervisor on public.shifts;
create policy shifts_insert_supervisor on public.shifts
  for insert to authenticated
  with check (public.auth_role() = 'supervisor');

drop policy if exists shifts_update_supervisor on public.shifts;
create policy shifts_update_supervisor on public.shifts
  for update to authenticated
  using (public.auth_role() = 'supervisor')
  with check (public.auth_role() = 'supervisor');

drop policy if exists shifts_delete_supervisor on public.shifts;
create policy shifts_delete_supervisor on public.shifts
  for delete to authenticated
  using (public.auth_role() = 'supervisor');

-- 5.3 shift_assignments: everyone reads, supervisors write.
drop policy if exists shift_assignments_select on public.shift_assignments;
create policy shift_assignments_select on public.shift_assignments
  for select to authenticated
  using (true);

drop policy if exists shift_assignments_insert_supervisor on public.shift_assignments;
create policy shift_assignments_insert_supervisor on public.shift_assignments
  for insert to authenticated
  with check (public.auth_role() = 'supervisor');

drop policy if exists shift_assignments_update_supervisor on public.shift_assignments;
create policy shift_assignments_update_supervisor on public.shift_assignments
  for update to authenticated
  using (public.auth_role() = 'supervisor')
  with check (public.auth_role() = 'supervisor');

drop policy if exists shift_assignments_delete_supervisor on public.shift_assignments;
create policy shift_assignments_delete_supervisor on public.shift_assignments
  for delete to authenticated
  using (public.auth_role() = 'supervisor');

-- 5.4 log_entries: supervisors read everything; operators read and write only
-- their own shifts, and only while that shift's handover is still open.
drop policy if exists log_entries_select on public.log_entries;
create policy log_entries_select on public.log_entries
  for select to authenticated
  using (public.auth_role() = 'supervisor' or public.is_assigned(shift_id));

drop policy if exists log_entries_insert_assigned_operator on public.log_entries;
create policy log_entries_insert_assigned_operator on public.log_entries
  for insert to authenticated
  with check (
    public.auth_role() = 'operator'
    and author_id = auth.uid()
    and public.is_assigned(shift_id)
    and public.shift_handover_open(shift_id)
  );

drop policy if exists log_entries_update_own on public.log_entries;
create policy log_entries_update_own on public.log_entries
  for update to authenticated
  using (
    author_id = auth.uid()
    and public.is_assigned(shift_id)
    and public.shift_handover_open(shift_id)
  )
  with check (
    author_id = auth.uid()
    and public.is_assigned(shift_id)
    and public.shift_handover_open(shift_id)
  );

drop policy if exists log_entries_delete_own on public.log_entries;
create policy log_entries_delete_own on public.log_entries
  for delete to authenticated
  using (
    author_id = auth.uid()
    and public.is_assigned(shift_id)
    and public.shift_handover_open(shift_id)
  );

-- 5.5 handovers: supervisors read everything, assigned operators read their own
-- shift's. The author writes while draft or changes_requested; a supervisor may
-- only move a submitted handover onwards (FR-2.3). The BEFORE UPDATE trigger in
-- 4.3 is what stops a supervisor editing content.
drop policy if exists handovers_select on public.handovers;
create policy handovers_select on public.handovers
  for select to authenticated
  using (public.auth_role() = 'supervisor' or public.is_assigned(shift_id));

drop policy if exists handovers_insert_assigned_operator on public.handovers;
create policy handovers_insert_assigned_operator on public.handovers
  for insert to authenticated
  with check (
    public.auth_role() = 'operator'
    and author_id = auth.uid()
    and public.is_assigned(shift_id)
    and status = 'draft'
  );

drop policy if exists handovers_update_author on public.handovers;
create policy handovers_update_author on public.handovers
  for update to authenticated
  using (
    author_id = auth.uid()
    and status in ('draft', 'changes_requested')
  )
  with check (
    author_id = auth.uid()
    and status in ('draft', 'submitted')
  );

drop policy if exists handovers_update_supervisor on public.handovers;
create policy handovers_update_supervisor on public.handovers
  for update to authenticated
  using (
    public.auth_role() = 'supervisor'
    and status = 'submitted'
  )
  with check (
    public.auth_role() = 'supervisor'
    and status in ('approved', 'changes_requested')
    and reviewed_by = auth.uid()
  );

-- No delete policy: handovers are never deleted by a client.

-- 5.6 handover_reviews: supervisors and the reviewed shift's operators read;
-- only a supervisor writes; never updated or deleted, so a handover revised
-- twice keeps both rounds of feedback (FR-7.5).
drop policy if exists handover_reviews_select on public.handover_reviews;
create policy handover_reviews_select on public.handover_reviews
  for select to authenticated
  using (
    public.auth_role() = 'supervisor'
    or public.is_assigned(public.handover_shift(handover_id))
  );

drop policy if exists handover_reviews_insert_supervisor on public.handover_reviews;
create policy handover_reviews_insert_supervisor on public.handover_reviews
  for insert to authenticated
  with check (
    public.auth_role() = 'supervisor'
    and reviewer_id = auth.uid()
  );

-- 5.7 notifications: own rows only. There is no insert policy at all, so the
-- only writer is the SECURITY DEFINER trigger in 4.5 (FR-8.2, FR-8.5).
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. Grants
--
-- RLS decides which rows are visible; these grants decide which verbs are
-- reachable at all. `anon` is granted nothing: every route is behind a session.
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, insert, update          on public.profiles          to authenticated;
grant select, insert, update, delete  on public.shifts            to authenticated;
grant select, insert, update, delete  on public.shift_assignments to authenticated;
grant select, insert, update, delete  on public.log_entries       to authenticated;
grant select, insert, update          on public.handovers         to authenticated;
grant select, insert                  on public.handover_reviews  to authenticated;
grant select, update, delete          on public.notifications     to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Realtime
--
-- The header notification bell subscribes to its own rows (FR-8.3). Adding the
-- table here keeps this file the single SQL round trip. RLS still applies to
-- realtime, so a subscriber only ever receives their own notifications.
-- -----------------------------------------------------------------------------

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then
  raise notice 'publication supabase_realtime not found; skipping realtime setup';
end $$;
