-- ============================================================================
-- Migration 003 — moving a label onto something else, atomically.
--
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
--
-- Why a function rather than two updates from the client:
--
-- The event log is append-only, enforced by policy — clients may select and
-- insert, nothing else. That is deliberate: history that a client can rewrite
-- is not history. But retiring a record renames its id, and its events have to
-- follow, or the record arrives at its new id with an empty past.
--
-- Relaxing the policy to allow updates would hand every client the ability to
-- edit the log. Instead this is the one operation permitted to do it: a
-- SECURITY DEFINER function that renames the row, carries its events across and
-- writes the `recoded` entry, all in one transaction. Nothing else can touch an
-- event once it is written.
-- ============================================================================

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
