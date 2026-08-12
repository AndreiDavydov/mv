-- ============================================================================
-- Migration 004 — fix how deletes handle contents.
--
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
-- Requires 002 and 003.
--
-- Migration 003 added a BEFORE DELETE trigger that released a container's
-- contents. It is wrong: when a parent and one of its children are deleted by
-- the same statement — a bulk cleanup, the import path, any `delete where id
-- like ...` — the trigger updates a row that the same command is already
-- deleting, and Postgres refuses with "tuple to be updated was already modified
-- by an operation triggered by the current command".
--
-- The foreign key can express this on its own. NO ACTION is checked at the end
-- of the statement rather than per row, so deleting a box together with its
-- contents is fine, while deleting a box out from under its contents is
-- refused — which is what should happen, because the caller has to decide
-- where those things go. `markGone` already releases them; undo now does too.
-- ============================================================================

drop trigger if exists things_release_children on public.things;
drop function if exists public.release_children();

alter table public.things drop constraint if exists things_parent_id_fkey;
alter table public.things add constraint things_parent_id_fkey
  foreign key (parent_id) references public.things(id)
  on delete no action
  on update cascade
  deferrable initially deferred;
