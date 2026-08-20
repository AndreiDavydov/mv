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

## ~~5. Reassigning a code to a different thing~~ — done

A label outlives its first use. Retiring rather than overwriting: `K7M3` becomes
`K7M3-1`, keeping its name, photo, contents and history, and `K7M3` is free to
scan onto something new. Reuse it again and the next is `K7M3-2`. The rename is
a `SECURITY DEFINER` function because the event log is append-only by policy and
a record's history has to follow it.

Analysis and flow: [STATES.md §5](STATES.md).

## 6. Camera + text entry problems during scanning — STILL OPEN

Reported but never described: "a few problems when scanning with camera and
adding text". Needs specifics before anything is changed — which screen, what
was expected, what happened. This is the oldest open item.

## ~~7. Gone items were invisible in the list~~ — done

Struck through and tagged `gone` in the Catalog and in search, and excluded from
the packing pick-list.

## ~~8. Gaps found by auditing the state space~~ — done

[STATES.md](STATES.md) enumerates 27 containment configurations and 128 states.
All four leaks are closed, and the rules now live in one place —
`app/src/core/capabilities.js` — which the buttons ask, the writes ask, and the
database backs with constraints and triggers.

---

## Still open

1. **The printed labels have never been scan-tested.** Four sheets are printed
   (`2222` … `22A5`). Stick five, scan them in the worst light you will actually
   work in. Modules are 0.551 mm against the 0.72 mm the brief assumed; if they
   fail, the three fallbacks are in [BUILD.md](BUILD.md) under *QR size*.
2. **Camera + text problems** — item 6, still undescribed.
3. **A photo can only be taken during enrolment**, on a screen you see once. Get
   a bad shot and there is no way back to it. Edit should take one.
4. **`events.actor` is a dead column.** "Who packed this" is the one question a
   shared catalog can answer that a solo one cannot, and nothing writes it. It
   needs a name per device, asked once. Either use it or drop the column.
5. **Unpacking at the far end** is only half-supported: **Empty** takes
   everything out of a box, but there is no "tick items off as they come out".
6. **Supabase free projects pause after about a week idle.** Over a multi-week
   move this will happen: the app shows "No connection to the catalog" and it
   takes a click in the Supabase dashboard to wake. Not a bug, but it will look
   like one at the worst moment.
7. **The catalog view fetches every row on each refresh.** Fine at 260 labels
   (~100 kB); past a couple of thousand it wants pagination.
