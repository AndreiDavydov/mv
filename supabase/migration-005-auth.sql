-- ============================================================================
-- Migration 005 — close the catalog.
--
-- Until now the anon key was the only thing between a stranger and this data,
-- and that key ships inside a public static site: config.js is readable at
-- <base>/config.js, and every sticker tells you where the site is. Anyone who
-- scanned a box could read the whole catalog, and — because things_anon_all
-- granted `for all` — empty it.
--
-- After this, `anon` can do nothing at all. Not "sees an empty catalog": every
-- select returns zero rows and every write is refused, by Postgres, before any
-- application code runs. That is what makes the locked page in the app honest
-- rather than decorative.
--
--
-- TWO STEPS THAT ARE NOT SQL — do both, in this order, or this migration
-- achieves nothing:
--
--   1. Authentication → Sign In / Providers → Email:
--      turn OFF "Allow new users to sign up".
--
--      This is the important one. `authenticated` is not a club you are
--      invited to — without this, anyone holding the anon key can call
--      signUp(), become authenticated, and walk straight through every policy
--      below. Disabling signups makes the crew account the only door.
--
--   2. Authentication → Users → Add user → Create new user:
--      email    crew@moving.invalid   (must match CREW_EMAIL in config.js)
--      password whatever you will tell your friends
--      tick     Auto Confirm User     (no mail is ever sent to that address)
--
-- To change the password later: same screen, edit the user. Everyone re-enters
-- it once. That is the whole revocation story, and for a house move it is the
-- right weight.
-- ============================================================================

-- ── things ──────────────────────────────────────────────────────────────────

drop policy if exists things_anon_all on public.things;
drop policy if exists things_crew_all on public.things;

create policy things_crew_all on public.things
  for all to authenticated using (true) with check (true);

-- ── events stay append-only, and now only for signed-in people ───────────────
--
-- Two policies, select and insert. There is deliberately no update policy and
-- no delete policy: RLS denies anything it has not been told to allow, so the
-- log cannot be edited or erased by anybody holding the shared password — the
-- database refuses, and there is no application flag to flip.
--
-- That is the answer to "someone does something, then cleans up after
-- themselves". They cannot. A thing row can be deleted (things_crew_all is
-- `for all`), but events carry no foreign key to things, so the row going away
-- leaves `enrolled ZZ4B "espresso machine"` and `deleted ZZ4B` standing in the
-- log, stamped with the name that did it.
--
-- The single exception is public.retire_code(), which moves a record's events
-- to its new id when a label is reassigned. It is SECURITY DEFINER precisely
-- so that this one operation can do what no client is allowed to do, and it
-- only ever renames — it deletes nothing.

drop policy if exists events_anon_read on public.events;
drop policy if exists events_anon_insert on public.events;
drop policy if exists events_crew_read on public.events;
drop policy if exists events_crew_insert on public.events;

create policy events_crew_read on public.events
  for select to authenticated using (true);

create policy events_crew_insert on public.events
  for insert to authenticated with check (true);

-- Reassigning a label is a signed-in action like any other.
revoke execute on function public.retire_code(text) from anon;
grant execute on function public.retire_code(text) to authenticated;

-- ── photos ──────────────────────────────────────────────────────────────────
--
-- Uploading now requires a session. Reading does not: the bucket stays public,
-- because a public URL is what lets <img src> work without a token that expires
-- mid-session and without threading signed-URL refresh through every view.
--
-- What makes that acceptable is that photo paths stopped being guessable. They
-- used to be `<ID>.jpg` — and the ID is printed on the box, so anyone who could
-- read config.js could fetch the photo of any label they had seen. They are now
-- `<ID>-<random>.jpg`, and the only place that random half exists is the
-- things row, which anon can no longer read.
--
-- Dropping update as well as delete is not an oversight. An upsert onto the
-- same path replaced the previous image, which is the one way a photo could be
-- destroyed; unique paths plus insert-only means re-photographing something
-- adds a file and leaves the old one where it was.

drop policy if exists photos_anon_read on storage.objects;
drop policy if exists photos_anon_write on storage.objects;
drop policy if exists photos_anon_update on storage.objects;
drop policy if exists photos_crew_write on storage.objects;

create policy photos_crew_write on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');

-- ── proof ───────────────────────────────────────────────────────────────────
-- Should list exactly four policies, all of them `{authenticated}`, and events
-- should show only SELECT and INSERT.

select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename in ('things', 'events')
order by tablename, cmd;
