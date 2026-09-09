-- =============================================================================
-- Demo seed, part 1 of 2: shifts only.
--
-- Run this in the Supabase SQL editor immediately after 0001_init.sql.
--
-- Shifts only, deliberately. Auth users cannot be seeded from SQL without a
-- service-role key, and this project has none (requirement.md section 9.2), so
-- the demo accounts are created through the register form in the app. Once they
-- exist, run supabase/seed_assignments.sql to roster them onto these shifts.
--
-- Two locations, one week (the current Monday-Sunday week, UTC) of
-- Morning / Evening / Night slots: 42 rows. Re-running is safe; a slot is only
-- inserted when the same location + name + start time is not already present.
-- =============================================================================

with week_start as (
  select date_trunc('week', (now() at time zone 'utc')) as monday
),
days as (
  select (select monday from week_start) + (d || ' days')::interval as day
  from generate_series(0, 6) as d
),
locations as (
  select unnest(array['Terminal 2', 'Ward B']) as location
),
slots as (
  select *
  from (values
    ('Morning', interval  '6 hours', interval '8 hours'),
    ('Evening', interval '14 hours', interval '8 hours'),
    ('Night',   interval '22 hours', interval '8 hours')
  ) as t (name, start_offset, duration)
)
insert into public.shifts (location, name, starts_at, ends_at)
select l.location,
       s.name,
       (d.day + s.start_offset) at time zone 'utc',
       (d.day + s.start_offset + s.duration) at time zone 'utc'
from days d
cross join locations l
cross join slots s
where not exists (
  select 1
  from public.shifts x
  where x.location = l.location
    and x.name = s.name
    and x.starts_at = (d.day + s.start_offset) at time zone 'utc'
);

-- Sanity check: expect 42 rows for the current week.
select location, count(*) as slots, min(starts_at) as first_slot, max(ends_at) as last_slot
from public.shifts
group by location
order by location;
