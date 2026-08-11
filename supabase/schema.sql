-- ============================================================================
-- Shared catalog schema.
--
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE.
--
-- Access model: no accounts. Anyone with the site URL and the anon key can
-- read and write the catalog. That is deliberate — helpers should be able to
-- open a link and start scanning — but it does mean the anon key is a shared
-- password, and it ships inside a public static site. Do not put anything in
-- here you would mind a stranger reading. See NOTES at the bottom.
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

drop policy if exists things_anon_all on public.things;
create policy things_anon_all on public.things
  for all to anon, authenticated using (true) with check (true);

-- Insert and read only: the log is append-only, and the database enforces it
-- rather than trusting every client to behave. Undo appends a reversal.
drop policy if exists events_anon_read on public.events;
create policy events_anon_read on public.events
  for select to anon, authenticated using (true);

drop policy if exists events_anon_insert on public.events;
create policy events_anon_insert on public.events
  for insert to anon, authenticated with check (true);

-- ── photo storage ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists photos_anon_read on storage.objects;
create policy photos_anon_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'photos');

drop policy if exists photos_anon_write on storage.objects;
create policy photos_anon_write on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'photos');

drop policy if exists photos_anon_update on storage.objects;
create policy photos_anon_update on storage.objects
  for update to anon, authenticated using (bucket_id = 'photos');

-- ============================================================================
-- NOTES
--
-- The anon key is a shared password baked into a public site. For a house move
-- among friends that is the right trade — a helper opens a link and works.
-- If that stops being acceptable, the smallest fix that keeps labels working
-- is to turn on Supabase Auth and change `to anon` to `to authenticated` in
-- every policy above; the app then asks for a magic-link sign-in once.
-- ============================================================================
