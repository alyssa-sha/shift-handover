-- =============================================================================
-- Demo seed, part 2 of 2: shift assignments.
--
-- RUN THIS SECOND, and only after the demo accounts exist.
--
-- Order of operations for a fresh project:
--   1. supabase/migrations/0001_init.sql   (schema, RLS, triggers)
--   2. supabase/seed.sql                   (shift slots)
--   3. register the demo accounts in the app  (one supervisor, two operators)
--   4. this file                           (roster the operators onto the slots)
--
-- Step 3 cannot be done in SQL. Creating an auth user needs the Admin API and a
-- service-role key, and this project has none by design (requirement.md
-- section 9.2). So the accounts are created through /register, which is also
-- what populates public.profiles via the on_auth_user_created trigger.
--
-- This file reads whichever operator profiles happen to exist and deals the
-- current week's slots out among them in start-time order, so consecutive slots
-- at a location land on different operators. That is what makes the handover
-- demo work: the outgoing operator hands over to a different incoming operator.
--
-- Supervisors are intentionally not assigned to shifts; they review only
-- (requirement.md section 12).
--
-- Re-running is safe: the unique constraint on (shift_id, user_id) plus
-- `on conflict do nothing` makes it a no-op the second time.
-- =============================================================================

do $$
declare
  v_operators integer;
begin
  select count(*) into v_operators from public.profiles where role = 'operator';
  if v_operators = 0 then
    raise exception
      'No operator profiles found. Register the demo accounts in the app first, then re-run this file.';
  end if;
  raise notice 'Rostering % operator(s) onto this week''s shifts.', v_operators;
end $$;

with operators as (
  select id,
         row_number() over (order by created_at, id) - 1 as seq,
         count(*) over ()                                as total
  from public.profiles
  where role = 'operator'
),
week as (
  select id,
         row_number() over (order by starts_at, location, id) - 1 as seq
  from public.shifts
  where starts_at >= (date_trunc('week', (now() at time zone 'utc'))) at time zone 'utc'
    and starts_at <  (date_trunc('week', (now() at time zone 'utc')) + interval '7 days') at time zone 'utc'
)
insert into public.shift_assignments (shift_id, user_id)
select w.id, o.id
from week w
join operators o on (w.seq % o.total) = o.seq
on conflict on constraint shift_assignments_shift_user_key do nothing;

-- Sanity check: every operator should now hold a share of the week.
select p.full_name,
       p.role,
       count(sa.id) as assigned_shifts
from public.profiles p
left join public.shift_assignments sa on sa.user_id = p.id
group by p.id, p.full_name, p.role
order by p.role, p.full_name;
