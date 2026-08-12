-- ============================================================================
-- Migration 002 — make the invariants true rather than customary.
--
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
--
-- Three things the app assumed and nothing enforced:
--   1. packed ⟺ in a box
--   2. a container that is gone is empty
--   3. a label can be moved to another thing without losing the first thing
-- ============================================================================

-- ── 1. an id is either a live label or a retired record ─────────────────────
--
-- `K7M3`   a code on a physical sticker, scannable
-- `K7M3-1` what that record becomes when the sticker is moved to something
--          else: history, photos and contents intact, simply not on anything
--          any more. Retiring rather than overwriting is what lets the same
--          label be reused twice without the log describing two objects at once.

alter table public.things drop constraint if exists things_id_check;
alter table public.things add constraint things_id_check
  check (id ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(-[0-9]{1,3})?$');

-- ── 2. renaming an id carries its contents with it ──────────────────────────
--
-- Retiring a record rewrites its id, and everything inside it has to follow.
-- Without ON UPDATE CASCADE the children would point at an id that no longer
-- exists — the ghost this migration is here to make impossible.

alter table public.things drop constraint if exists things_parent_id_fkey;
alter table public.things add constraint things_parent_id_fkey
  foreign key (parent_id) references public.things(id)
  on delete set null
  on update cascade;

-- ── 3. packed ⟺ in a box ────────────────────────────────────────────────────
--
-- The client always wrote these together, so this held by habit. An import, a
-- second client, or a careless patch could break it. Now it cannot.

update public.things set status = 'packed'   where parent_id is not null and status <> 'packed';
update public.things set status = 'unpacked' where parent_id is null and status = 'packed';

alter table public.things drop constraint if exists things_packed_has_parent;
alter table public.things add constraint things_packed_has_parent
  check ((status = 'packed') = (parent_id is not null));

-- ── 4. nothing is inside a container that is gone ───────────────────────────
--
-- Marking a box gone used to clear only the box's own parent, leaving its
-- contents pointing at something the catalog says no longer exists. The app now
-- empties a box before it can be marked gone; this is the backstop, and it
-- repairs anything already in that state.

update public.things child
   set parent_id = null, status = 'unpacked'
  from public.things parent
 where child.parent_id = parent.id
   and parent.status = 'gone';

create or replace function public.check_gone_is_empty() returns trigger as $$
begin
  if new.status = 'gone' and exists (select 1 from public.things where parent_id = new.id) then
    raise exception 'take everything out of % before marking it gone', new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists things_gone_is_empty on public.things;
create trigger things_gone_is_empty
  before update of status on public.things
  for each row execute function public.check_gone_is_empty();

-- ── 5. one more event type ──────────────────────────────────────────────────

alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check
  check (type in ('enrolled','packed','unpacked','renamed','moved','deleted','restored','recoded'));
