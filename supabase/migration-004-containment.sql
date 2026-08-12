-- ============================================================================
-- Migration 004 — the containment rules the client believes but nothing checked.
--
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
--
-- Found by probing the live database rather than reading the code: three things
-- the app has always refused, and the database happily allowed.
-- ============================================================================

-- ── 1. only a container can contain, and not once it is gone ────────────────
--
-- `parent_id` had a foreign key to things(id) and nothing more, so any row
-- could be a parent — an item could contain a box. And a container marked gone
-- could still be packed into, which is the ghost of §4.1 arriving by the other
-- door.

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

-- ── 2. a kind belongs to a container ────────────────────────────────────────

update public.things set container_kind = null where is_container = false;

alter table public.things drop constraint if exists things_kind_needs_container;
alter table public.things add constraint things_kind_needs_container
  check (is_container or container_kind is null);

-- ── 3. deleting a container releases what is in it ──────────────────────────
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

-- ── 4. the ordering the catalog actually reads by ───────────────────────────

create index if not exists things_updated_idx on public.things (updated_at desc);
