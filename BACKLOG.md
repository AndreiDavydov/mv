# Backlog

Agreed after the first real run-through.

---

## ~~1. Rename "Tree" → "Catalog"~~ — done

It is called Tree because it draws the containment hierarchy. That is naming a
screen after its implementation, and nesting is not the point right now — the
point is "everything I have". Rename the tab and the heading; keep the nesting
display, it costs nothing and stays useful once boxes go inside crates.

## ~~2. Packing something already in the catalog~~ — done

**The gap:** to pack an item you must physically scan it. If it is already in
the catalog there is no way to put it in a box from the screen.

**Fix:** while packing, show a pick-list under the viewfinder — most recently
scanned first, unpacked items only, with a search box. Tapping one packs it.

Settled as shared, ordered by `updated_at` — with several helpers the thing you
want is usually the thing somebody just touched. The list refreshes in place
rather than remounting the screen, so the viewfinder does not restart on every
write, including other people's.

## ~~3. Drop rooms~~ — done

Removed the room chips from enrolment and from edit, and stop offering `ROOMS` in
config. It is a field nobody is filling during an actual pack.

Keep the `room` column in the database — dropping a column is a migration, and
adding the UI back later is a few lines. Search should stop matching on it.

## ~~4. Drop `shelf` from container kinds~~ — done

Leaves `box`, `suitcase`, `crate`, `bag`. A shelf is not a thing you carry.

## 5. Camera + text entry problems during scanning

Reported but not yet described: "a few problems when scanning with camera and
adding text". Needs specifics before anything is changed — which screen, what
was expected, what happened.

---

## Also outstanding

- **`npm run test:e2e` is stale.** It still drives IndexedDB directly and clicks
  the Undo tab that no longer exists, so parts of it are broken or assert
  nothing. Real coverage now lives in `npm run test:live` (23 tests against the
  real database). The suite needs rewriting against the shared catalog.
- **The printed label test has never been run.** `proofs/sheet-2222.pdf` is
  ready; five labels need to scan first-try at arm's length in poor light. The
  modules are 0.551 mm, below the 0.72 mm the original brief assumed — see the
  *QR size* section in [BUILD.md](BUILD.md) for the three fallbacks if they fail.
- **Test junk in the database:** a `ZZZZ` probe event and `photos/probe.txt`.
  Neither is deletable with the anon key by design. Clear with
  `delete from public.events where thing_id = 'ZZZZ';` in the SQL editor.

## 6. Gone items were invisible in the list — done

A thing marked gone read exactly like a tracked one. It is now struck through
and tagged `gone` in the Catalog and in search results, and excluded from the
packing pick-list.
