-- ============================================================================
-- Optional: purge the log and photos left over from testing.
--
-- Run in the Supabase SQL editor. Not required — the catalog is already empty
-- and nothing below affects how the app behaves. It only clears the history of
-- rows that no longer exist.
--
-- The app cannot do this itself, by design: the event log is append-only and
-- clients may insert but never delete. That is what makes the history worth
-- having, and it is also why a leftover 2,220 rows of test events can only be
-- swept up from here.
-- ============================================================================

delete from public.events;

-- Photos of things that no longer exist. Storage deletes are likewise not
-- something the app is allowed to do.
delete from storage.objects
 where bucket_id = 'photos'
   and name not in (select id || '.jpg' from public.things where photo_url is not null);

select
  (select count(*) from public.things)                                  as things,
  (select count(*) from public.events)                                  as events,
  (select count(*) from storage.objects where bucket_id = 'photos')     as photos;
