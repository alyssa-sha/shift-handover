-- =============================================================================
-- Demo synthetic cases, part 3 of 3.
--
-- RUN THIS LAST:
--   1. supabase/migrations/0001_init.sql   (schema, RLS, triggers)
--   2. supabase/seed.sql                   (42 shift slots for the current week)
--   3. register the demo accounts in the app   (see supabase/DEMO_ACCOUNTS.md)
--   4. supabase/seed_assignments.sql       (roster the operators onto the slots)
--   5. this file                           (logs, handovers, review history)
--
-- Everything here is synthetic. No real person, patient, flight or incident is
-- described, and nothing in this file sends email.
--
-- It stages the current week's MONDAY and TUESDAY at Terminal 2 so that every
-- screen has something real to show the moment you log in:
--
--   Mon Morning  published handover + incident-heavy log   -> the incoming
--                operator reads it from the calendar (FR-4.4), and approving it
--                through the real trigger leaves notification rows (FR-8.1)
--   Mon Evening  submitted handover                        -> sits in the
--                supervisor's review queue (FR-7.1)
--   Mon Night    changes_requested + feedback              -> the revision loop
--                (FR-7.4), editable again by its author
--   Tue Morning  16 log entries, 2 of them critical, and NO handover yet
--                -> this is the shift to demo "Create handover" and, once M4
--                lands, "Draft with AI" against FR-6.8's severity weighting
--
-- Re-running is safe: every insert is guarded, so a second run is a no-op.
-- =============================================================================

-- Fail early and loudly rather than silently seeding nothing.
do $$
declare
  v_operators int;
  v_supervisors int;
  v_assignments int;
begin
  select count(*) into v_operators   from public.profiles where role = 'operator';
  select count(*) into v_supervisors from public.profiles where role = 'supervisor';
  select count(*) into v_assignments from public.shift_assignments;

  if v_supervisors = 0 then
    raise exception 'No supervisor profile found. Register the demo accounts (step 3) first.';
  end if;
  if v_operators < 2 then
    raise exception 'Found % operator profile(s); the demo needs at least 2.', v_operators;
  end if;
  if v_assignments = 0 then
    raise exception 'No shift assignments. Run supabase/seed_assignments.sql (step 4) first.';
  end if;
end $$;

-- One resolved view of the four staged slots, so no timestamp expression is
-- repeated. day_offset 0 = Monday of the current week.
--
-- This is scaffolding, not part of the schema. A view in `public` is exposed by
-- PostgREST and would be readable by any signed-in user, so it is locked down on
-- creation and dropped again at the bottom of this file.
create or replace view public.demo_staged_slots as
with anchor as (
  select date_trunc('week', (now() at time zone 'utc')) as monday
),
wanted as (
  select * from (values
    ('Morning', 0, interval  '6 hours'),
    ('Evening', 0, interval '14 hours'),
    ('Night',   0, interval '22 hours'),
    ('Morning', 1, interval  '6 hours')
  ) as t (slot_name, day_offset, start_offset)
)
select w.slot_name,
       w.day_offset,
       s.id        as shift_id,
       s.starts_at,
       s.ends_at,
       (select sa.user_id
          from public.shift_assignments sa
         where sa.shift_id = s.id
         order by sa.created_at, sa.id
         limit 1) as operator_id
from wanted w
join anchor a on true
join public.shifts s
  on s.location = 'Terminal 2'
 and s.name     = w.slot_name
 and s.starts_at = (a.monday + (w.day_offset || ' days')::interval + w.start_offset) at time zone 'utc';

revoke all on public.demo_staged_slots from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Monday Morning, Terminal 2 -- the incident-heavy shift that gets published.
-- -----------------------------------------------------------------------------

insert into public.log_entries (shift_id, author_id, severity, content, created_at)
select d.shift_id,
       d.operator_id,
       v.severity::public.log_severity,
       v.content,
       least(d.starts_at + v.at_offset, now())
from public.demo_staged_slots d
cross join (values
  ('info',     'Shift start. Handover from night shift read and acknowledged. Staffing at full complement.', interval '5 minutes'),
  ('info',     'Stand 12 pushback equipment inspected, serviceable.',                                        interval '35 minutes'),
  ('critical', 'Baggage belt 3 stopped with a jam at the transfer point. Belt isolated, 40 minutes of outbound bags rerouted to belt 5 by hand. Engineering attended 08:20 and cleared a crushed case from the roller bed. Belt returned to service 09:05. Root cause not yet established -- engineering ticket ENG-4471 raised and still open.', interval '1 hour 50 minutes'),
  ('warning',  'Two-way radio channel 4 intermittent in the east pier. Spare handset issued. Not escalated.', interval '2 hours 30 minutes'),
  ('info',     'Passenger assistance volumes above forecast for the 09:00 bank; absorbed without delay.',     interval '3 hours'),
  ('critical', 'Fire door FD-217 on the east pier found wedged open with a cleaning trolley. Door cleared and closed immediately, and the contractor supervisor was briefed on site. This is the second time this door has been found obstructed this week -- the first was logged by the night shift on Sunday. Needs escalation to facilities, not just another log entry.', interval '4 hours 15 minutes'),
  ('info',     'Belt 3 monitored through the 11:00 bank, no recurrence.',                                     interval '5 hours'),
  ('warning',  'Stand 14 ground power unit showing an intermittent fault light. Tagged, and stand kept out of allocation for the rest of the shift.', interval '6 hours'),
  ('info',     'End of shift walkaround complete. East pier clear, belts running.',                            interval '7 hours 40 minutes')
) as v (severity, content, at_offset)
where d.slot_name = 'Morning'
  and d.day_offset = 0
  and d.operator_id is not null
  and not exists (select 1 from public.log_entries le where le.shift_id = d.shift_id);

insert into public.handovers (shift_id, author_id, content, status, ai_assisted, submitted_at)
select d.shift_id,
       d.operator_id,
       'INCIDENTS' || chr(10) ||
       '1. Baggage belt 3 jammed at the transfer point (07:50-09:05). Belt isolated, ' ||
       'outbound bags rerouted to belt 5 by hand for 40 minutes. Engineering cleared a ' ||
       'crushed case from the roller bed. Root cause NOT established. ENG-4471 is still ' ||
       'open -- please check for recurrence through your bank and add to the ticket.' || chr(10) ||
       '2. Fire door FD-217 (east pier) found wedged open by a cleaning trolley at 10:15. ' ||
       'Cleared on the spot and the contractor supervisor briefed. This is the SECOND ' ||
       'obstruction of this door this week; the night shift logged the first on Sunday. ' ||
       'I have not escalated to facilities yet -- that needs doing today.' || chr(10) || chr(10) ||
       'WATCH ITEMS' || chr(10) ||
       '- Stand 14 ground power unit has an intermittent fault light. Tagged and held out ' ||
       'of allocation. Do not re-allocate until engineering signs it off.' || chr(10) ||
       '- Radio channel 4 is intermittent in the east pier. Spare handset issued.' || chr(10) || chr(10) ||
       'ROUTINE' || chr(10) ||
       'Full staffing. Assistance volumes ran above forecast for the 09:00 bank and were ' ||
       'absorbed without delay. Belt 3 monitored through the 11:00 bank with no recurrence. ' ||
       'End-of-shift walkaround complete, east pier clear.',
       'submitted',
       false,
       least(d.ends_at - interval '15 minutes', now())
from public.demo_staged_slots d
where d.slot_name = 'Morning'
  and d.day_offset = 0
  and d.operator_id is not null
on conflict (shift_id) do nothing;

-- Approve it through a real UPDATE so the fan-out trigger fires and the incoming
-- shift genuinely has notification rows waiting (FR-8.1). Inserting it as
-- 'approved' directly would skip the trigger and leave the bell empty.
update public.handovers h
set status      = 'approved',
    reviewed_by = (select id from public.profiles where role = 'supervisor' order by created_at, id limit 1),
    reviewed_at = least(h.submitted_at + interval '25 minutes', now())
from public.demo_staged_slots d
where d.slot_name = 'Morning'
  and d.day_offset = 0
  and h.shift_id = d.shift_id
  and h.status = 'submitted';

insert into public.handover_reviews (handover_id, reviewer_id, decision, feedback, created_at)
select h.id,
       h.reviewed_by,
       'approved'::public.review_decision,
       'Clear and complete. Thank you for flagging FD-217 as a repeat rather than a one-off -- I have taken the facilities escalation.',
       h.reviewed_at
from public.handovers h
join public.demo_staged_slots d on d.shift_id = h.shift_id
where d.slot_name = 'Morning'
  and d.day_offset = 0
  and h.reviewed_by is not null
  and not exists (select 1 from public.handover_reviews r where r.handover_id = h.id);

-- -----------------------------------------------------------------------------
-- 2. Monday Evening -- submitted, waiting in the supervisor's review queue.
-- -----------------------------------------------------------------------------

insert into public.log_entries (shift_id, author_id, severity, content, created_at)
select d.shift_id, d.operator_id, v.severity::public.log_severity, v.content,
       least(d.starts_at + v.at_offset, now())
from public.demo_staged_slots d
cross join (values
  ('info',    'Took over from morning shift. ENG-4471 (belt 3) noted and being watched.',                interval '10 minutes'),
  ('warning', 'Belt 3 threw a single fault code at 16:40 and self-cleared. Added to ENG-4471.',          interval '2 hours 40 minutes'),
  ('info',    'Evening departure bank ran to schedule.',                                                 interval '4 hours'),
  ('info',    'Stand 14 still tagged out of service, no change.',                                        interval '6 hours 20 minutes')
) as v (severity, content, at_offset)
where d.slot_name = 'Evening'
  and d.day_offset = 0
  and d.operator_id is not null
  and not exists (select 1 from public.log_entries le where le.shift_id = d.shift_id);

insert into public.handovers (shift_id, author_id, content, status, ai_assisted, submitted_at)
select d.shift_id,
       d.operator_id,
       'INCIDENTS' || chr(10) ||
       'None this shift.' || chr(10) || chr(10) ||
       'WATCH ITEMS' || chr(10) ||
       '- Belt 3 threw one fault code at 16:40 and self-cleared. Added to ENG-4471, which ' ||
       'is still open from the morning. Two events in one day -- treat the next one as a ' ||
       'pattern, not a coincidence.' || chr(10) ||
       '- Stand 14 GPU still tagged out of service. No engineering visit yet.' || chr(10) || chr(10) ||
       'ROUTINE' || chr(10) ||
       'Evening departure bank ran to schedule. Nothing else outstanding.',
       'submitted',
       false,
       least(d.ends_at - interval '10 minutes', now())
from public.demo_staged_slots d
where d.slot_name = 'Evening'
  and d.day_offset = 0
  and d.operator_id is not null
on conflict (shift_id) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Monday Night -- returned for revision, so the loop is visible on login.
-- -----------------------------------------------------------------------------

insert into public.log_entries (shift_id, author_id, severity, content, created_at)
select d.shift_id, d.operator_id, v.severity::public.log_severity, v.content,
       least(d.starts_at + v.at_offset, now())
from public.demo_staged_slots d
cross join (values
  ('info',     'Night shift start. Terminal quiet.',                                                     interval '15 minutes'),
  ('critical', 'Water ingress in the baggage hall ceiling above belt 6 after heavy rain. Belt 6 shut down and cordoned at 02:10 as a slip and electrical risk. Facilities on site 02:45, tray placed, area drying. Belt 6 remains OUT OF SERVICE pending an electrical check in daylight.', interval '4 hours 10 minutes'),
  ('info',     'Overnight cleaning completed on schedule apart from the cordoned area.',                  interval '5 hours 30 minutes')
) as v (severity, content, at_offset)
where d.slot_name = 'Night'
  and d.day_offset = 0
  and d.operator_id is not null
  and not exists (select 1 from public.log_entries le where le.shift_id = d.shift_id);

insert into public.handovers (shift_id, author_id, content, status, ai_assisted, submitted_at)
select d.shift_id,
       d.operator_id,
       'Quiet night. Some water in the baggage hall, facilities dealt with it. Belt 6 off.',
       'submitted',
       false,
       least(d.ends_at - interval '20 minutes', now())
from public.demo_staged_slots d
where d.slot_name = 'Night'
  and d.day_offset = 0
  and d.operator_id is not null
on conflict (shift_id) do nothing;

update public.handovers h
set status      = 'changes_requested',
    reviewed_by = (select id from public.profiles where role = 'supervisor' order by created_at, id limit 1),
    reviewed_at = least(h.submitted_at + interval '20 minutes', now())
from public.demo_staged_slots d
where d.slot_name = 'Night'
  and d.day_offset = 0
  and h.shift_id = d.shift_id
  and h.status = 'submitted';

insert into public.handover_reviews (handover_id, reviewer_id, decision, feedback, created_at)
select h.id,
       h.reviewed_by,
       'changes_requested'::public.review_decision,
       'This under-reports a critical. Belt 6 is out of service pending an electrical check '
       || 'and the morning shift will walk into that with no times, no ticket and no owner. '
       || 'Please add: when it was shut down and cordoned, when facilities attended, that the '
       || 'electrical check is outstanding, and who is picking it up. "Facilities dealt with '
       || 'it" is not a handover.',
       h.reviewed_at
from public.handovers h
join public.demo_staged_slots d on d.shift_id = h.shift_id
where d.slot_name = 'Night'
  and d.day_offset = 0
  and h.reviewed_by is not null
  and not exists (select 1 from public.handover_reviews r where r.handover_id = h.id);

-- -----------------------------------------------------------------------------
-- 4. Tuesday Morning -- 16 entries, 2 critical, NO handover yet.
--    This is the shift to demo "Create handover", and the FR-6.8 acceptance
--    case for M4: the two criticals must survive individually while the twelve
--    info entries get condensed.
-- -----------------------------------------------------------------------------

insert into public.log_entries (shift_id, author_id, severity, content, created_at)
select d.shift_id, d.operator_id, v.severity::public.log_severity, v.content,
       least(d.starts_at + v.at_offset, now())
from public.demo_staged_slots d
cross join (values
  ('info',     'Shift start, staffing complete.',                                          interval '5 minutes'),
  ('info',     'Belt 6 still out of service from the night shift. Cordon intact.',          interval '20 minutes'),
  ('info',     'Stand allocation reviewed for the morning bank.',                           interval '35 minutes'),
  ('info',     'Radio check completed across all channels, channel 4 now stable.',          interval '50 minutes'),
  ('critical', 'Security door SD-9 airside failed open at 07:12 and did not re-latch. Area held under manual watch by a member of staff until security engineering attended at 07:48 and replaced the strike plate. Door tested and confirmed re-latching at 08:05. Incident reference SEC-1180. The 53-minute gap needs to appear in the daily security report.', interval '1 hour 12 minutes'),
  ('info',     'Morning departure bank on schedule.',                                       interval '1 hour 40 minutes'),
  ('info',     'Assistance volumes normal.',                                                interval '2 hours'),
  ('info',     'Stand 14 GPU engineering visit booked for this afternoon.',                 interval '2 hours 20 minutes'),
  ('warning',  'Catering vehicle blocked the service road at stand 11 for around 10 minutes. Driver spoken to.', interval '2 hours 45 minutes'),
  ('info',     'Belt 3 running clean, no fault codes so far.',                              interval '3 hours'),
  ('info',     'Crew bus rotation adjusted for the 10:00 bank.',                            interval '3 hours 30 minutes'),
  ('critical', 'Fuel spill, approximately 20 litres, at stand 8 during refuelling at 10:35. Stand closed immediately, fire service attended and applied absorbent, and the fuelling contractor stood the bowser down pending inspection. Stand 8 REMAINS CLOSED and the contractor investigation is open. Incident reference OPS-2209.', interval '4 hours 35 minutes'),
  ('info',     'Stand 8 traffic re-allocated to stands 9 and 10 without delay.',            interval '4 hours 50 minutes'),
  ('warning',  'Passenger lift 2 in the east pier out of service, engineer called.',        interval '5 hours 20 minutes'),
  ('info',     'Belt 6 electrical check completed by facilities, belt returned to service.', interval '6 hours'),
  ('info',     'End of shift walkaround complete.',                                         interval '7 hours 45 minutes')
) as v (severity, content, at_offset)
where d.slot_name = 'Morning'
  and d.day_offset = 1
  and d.operator_id is not null
  and not exists (select 1 from public.log_entries le where le.shift_id = d.shift_id);

-- -----------------------------------------------------------------------------
-- Sanity check. Expect 4 rows: Mon Morning approved, Mon Evening submitted,
-- Mon Night changes_requested, Tue Morning with 16 entries and no handover.
-- -----------------------------------------------------------------------------
select d.slot_name,
       to_char(d.starts_at, 'Dy DD Mon HH24:MI')       as slot,
       p.full_name                                      as operator,
       count(le.id)                                     as log_entries,
       count(le.id) filter (where le.severity = 'critical') as critical,
       coalesce(h.status::text, '(no handover)')        as handover_status
from public.demo_staged_slots d
left join public.profiles    p  on p.id = d.operator_id
left join public.log_entries le on le.shift_id = d.shift_id
left join public.handovers   h  on h.shift_id = d.shift_id
group by d.slot_name, d.starts_at, p.full_name, h.status
order by d.starts_at;

-- Scaffolding removed. Nothing this file created outlives the run except the
-- demo rows themselves.
drop view if exists public.demo_staged_slots;
