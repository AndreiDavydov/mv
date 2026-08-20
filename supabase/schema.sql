-- ============================================================================
-- Shared catalog schema.
--
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE.
--
-- Access model: one shared account. `anon` — the role a browser holding the
-- public key gets — has no privilege on anything here, so a stranger who scans
-- a box reaches a locked page with nothing behind it. Helpers sign in once per
-- device with a password everyone shares. See NOTES at the bottom for the two
-- dashboard settings that make this real.
--
-- An existing project that predates this gets there via migration-005-auth.sql,
-- which also drops the old anon policies by name.
-- ============================================================================

-- ── things ──────────────────────────────────────────────────────────────────

create table if not exists public.things (
  id              text primary key
                  check (id ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$'),
  name            text,
  photo_url       text,
  thumb_url       text,
  is_container    boolean not null default false,
  container_kind  text check (container_kind in ('box','suitcase','crate','bag','shelf')),
  parent_id       text references public.things(id) on delete set null,
  tags            text[] not null default '{}',
  room            text,
  notes           text,
  status          text not null default 'unpacked'
                  check (status in ('unpacked','packed','gone')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists things_parent_idx on public.things (parent_id);
create index if not exists things_status_idx on public.things (status);
create index if not exists things_container_idx on public.things (is_container);
create index if not exists things_name_idx on public.things (lower(name));

-- ── events: append-only history, and what undo reverses ─────────────────────

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  thing_id   text not null,
  type       text not null
             check (type in ('enrolled','packed','unpacked','renamed','moved','deleted')),
  parent_id  text,
  payload    jsonb not null default '{}'::jsonb,
  actor      text,
  ts         timestamptz not null default now()
);

create index if not exists events_thing_idx on public.events (thing_id);
create index if not exists events_ts_idx on public.events (ts);

-- No foreign key to things: undoing an enrolment deletes the thing, and the
-- log has to outlive it. History that disappears with the row is not history.

-- ── a container cannot end up inside itself ─────────────────────────────────

create or replace function public.check_no_cycle() returns trigger as $$
declare
  cursor_id text := new.parent_id;
  hops int := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'a container cannot contain itself';
  end if;

  while cursor_id is not null and hops < 64 loop
    select parent_id into cursor_id from public.things where id = cursor_id;
    if cursor_id = new.id then
      raise exception '% is already inside %', new.parent_id, new.id;
    end if;
    hops := hops + 1;
  end loop;

  return new;
end;
$$ language plpgsql;

drop trigger if exists things_no_cycle on public.things;
create trigger things_no_cycle
  before insert or update of parent_id on public.things
  for each row execute function public.check_no_cycle();

-- ── updated_at maintained server-side, so clocks cannot disagree ────────────

create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists things_touch on public.things;
create trigger things_touch
  before update on public.things
  for each row execute function public.touch_updated_at();

-- ── realtime: every open screen sees a scan the moment it lands ─────────────

alter table public.things replica identity full;
alter table public.events replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.things;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null;
end $$;

-- ── row level security ──────────────────────────────────────────────────────

alter table public.things enable row level security;
alter table public.events enable row level security;

-- Every policy names `authenticated` and only `authenticated`. RLS denies what
-- it has not been told to allow, so leaving `anon` out of all of them is what
-- closes the catalog — there is no deny rule to add and none to forget.
drop policy if exists things_anon_all on public.things;
drop policy if exists things_crew_all on public.things;
create policy things_crew_all on public.things
  for all to authenticated using (true) with check (true);

-- Insert and read only: the log is append-only, and the database enforces it
-- rather than trusting every client to behave. Undo appends a reversal.
-- No update policy and no delete policy is the point, not an omission — it
-- means nobody with the shared password can erase what they did.
drop policy if exists events_anon_read on public.events;
drop policy if exists events_anon_insert on public.events;
drop policy if exists events_crew_read on public.events;
drop policy if exists events_crew_insert on public.events;
create policy events_crew_read on public.events
  for select to authenticated using (true);

create policy events_crew_insert on public.events
  for insert to authenticated with check (true);

-- ── photo storage ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

-- The bucket stays public so <img src> works without a token that expires
-- mid-session. What keeps photos private is that their paths are unguessable
-- (`<ID>-<random>.jpg`) and the only record of them is the things row, which
-- now needs a session to read. Uploading needs one too; there is deliberately
-- no update or delete policy, so a photo can be superseded but never replaced
-- in place or removed.
drop policy if exists photos_anon_read on storage.objects;
drop policy if exists photos_anon_write on storage.objects;
drop policy if exists photos_anon_update on storage.objects;
drop policy if exists photos_crew_write on storage.objects;
create policy photos_crew_write on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');

-- ============================================================================
-- NOTES
--
-- Two things here are not SQL, and without them none of the above matters:
--
--   1. Authentication → Sign In / Providers → Email: turn OFF "Allow new users
--      to sign up". Otherwise anyone holding the public key calls signUp(),
--      becomes `authenticated`, and every policy above waves them through.
--
--   2. Authentication → Users → Add user: create the one crew account, with
--      the address in CREW_EMAIL and Auto Confirm ticked. That address is a
--      name, not a mailbox; nothing is ever sent to it.
--
-- Changing the password on that user is the whole revocation story: everyone
-- re-enters it once. Nobody's individual work is lost, because who did what is
-- recorded by name in the event log rather than by account.
-- ============================================================================
