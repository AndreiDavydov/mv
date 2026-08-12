-- ============================================================================
-- Migration 003 — containment rules, and moving a label onto something else.
--
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Safe to re-run. Requires migration 002 to have been applied first.
--
-- Two unrelated things in one file only because neither was ever applied
-- separately. Part A closes three holes found by probing the live database:
-- rules the app has always enforced that Postgres happily allowed. Part B adds
-- the one operation permitted to touch the append-only event log.
-- ============================================================================


-- ══ PART A — containment ════════════════════════════════════════════════════

-- ── A1. only a container can contain, and not once it is gone ───────────────
--
-- `parent_id` had a foreign key to things(id) and nothing more, so any row
-- could be a parent — an item could contain a box. And a container marked gone
-- could still be packed into, which is the ghost of the emptied-box problem
-- arriving by the other door.

create or replace function public.check_parent_is_open_container() returns trigger as $$
declare
  parent public.things%rowtype;
begin
  if new.parent_id is null then return new; end if;

  select * into parent from public.things where id = new.parent_id;
  if not found then
    raise exception '% does not exist', new.parent_id;
  end if;
  if not parent.is_container then
    raise exception '% is not a container', new.parent_id;
  end if;
  if parent.status = 'gone' then
    raise exception '% was marked gone', new.parent_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists things_parent_is_open_container on public.things;
create trigger things_parent_is_open_container
  before insert or update of parent_id on public.things
  for each row execute function public.check_parent_is_open_container();

-- Repair anything already in that state.
update public.things child set parent_id = null, status = 'unpacked'
  from public.things parent
 where child.parent_id = parent.id
   and (parent.is_container = false or parent.status = 'gone');

-- ── A2. a kind belongs to a container ───────────────────────────────────────

update public.things set container_kind = null where is_container = false;

alter table public.things drop constraint if exists things_kind_needs_container;
alter table public.things add constraint things_kind_needs_container
  check (is_container or container_kind is null);

-- ── A3. deleting a container releases what is in it ─────────────────────────
--
-- `on delete set null` would leave a packed row with no parent, which migration
-- 002 forbids — so deleting a box that still held something failed with a raw
-- constraint message. Undoing the enrolment of a container somebody has since
-- packed into hits exactly that. Releasing the contents is what marking one
-- gone already does, and is the only sensible answer here too.

create or replace function public.release_children() returns trigger as $$
begin
  update public.things
     set parent_id = null, status = 'unpacked'
   where parent_id = old.id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists things_release_children on public.things;
create trigger things_release_children
  before delete on public.things
  for each row execute function public.release_children();

-- ── A4. the ordering the catalog actually reads by ──────────────────────────

create index if not exists things_updated_idx on public.things (updated_at desc);


-- ══ PART B — moving a label onto something else ═════════════════════════════
--
-- Why a function rather than two updates from the client:
--
-- The event log is append-only, enforced by policy — clients may select and
-- insert, nothing else. That is deliberate: history a client can rewrite is not
-- history. But retiring a record renames its id, and its events have to follow,
-- or the record arrives at its new id with an empty past.
--
-- Relaxing the policy would hand every client the ability to edit the log.
-- Instead this is the one operation permitted to do it: a SECURITY DEFINER
-- function that renames the row, carries its events across and writes the
-- `recoded` entry, all in one transaction. Nothing else can touch an event once
-- it is written.

create or replace function public.retire_code(code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  retired text;
  n int := 1;
begin
  if code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$' then
    raise exception '% is not a label code', code;
  end if;
  if not exists (select 1 from public.things where id = code) then
    raise exception '% is not enrolled', code;
  end if;

  -- The next free suffix: a label may be reused any number of times.
  loop
    retired := code || '-' || n;
    exit when not exists (select 1 from public.things where id = retired);
    n := n + 1;
    if n > 999 then
      raise exception '% has been reassigned too many times', code;
    end if;
  end loop;

  -- Contents follow automatically: things.parent_id is ON UPDATE CASCADE.
  update public.things set id = retired where id = code;

  -- Events do not have a foreign key — the log outlives the rows it describes —
  -- so they are carried across here.
  update public.events set thing_id = retired where thing_id = code;

  insert into public.events (thing_id, type, parent_id, payload)
  values (
    retired,
    'recoded',
    null,
    jsonb_build_object('group', 'recode-' || retired, 'before',
                       jsonb_build_object('id', code), 'after',
                       jsonb_build_object('id', retired))
  );

  return retired;
end;
$$;

revoke all on function public.retire_code(text) from public;
grant execute on function public.retire_code(text) to anon, authenticated;
