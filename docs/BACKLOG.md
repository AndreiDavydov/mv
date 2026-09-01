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

## ~~9. The catalog was open to anyone who scanned a box~~ — done

The anon key ships in `config.js`, which is served from the same site every
sticker points at — so anyone who scanned a label could read the whole catalog
and, because the policy was `for all`, empty it. Closed by
`supabase/migration-005-auth.sql`: `anon` holds no privilege on anything, and
one shared account replaces it. A stranger gets a locked page with nothing
behind it.

Two things came with it. **`events.actor` stopped being a dead column** — the
sign-in asks for a name, every event carries it, and the per-thing History shows
it, which is what makes "who packed this" answerable under a shared password.
And **photos moved to unguessable paths**, because `<ID>.jpg` was derivable from
the code printed on the box, and because an upsert onto a fixed path was the one
way something here could be destroyed rather than superseded.

The history itself was already safe and stays that way: `events` has a select
policy and an insert policy and nothing else, so nobody holding the password can
edit or delete what they did. That is Postgres refusing, not the app declining
to offer a button.

## ~~10. Packing was slow, and the phone got hot~~ — done

Reported from an actual packing session: 4–5 seconds per item, and a phone warm
enough to notice.

**Heat.** The QR decoder ran on every animation frame — sixty full decodes a
second, and on iOS each one is a canvas draw, a `getImageData` and a complete
jsQR pass. Now ten a second, behind an animation frame so a backgrounded tab
decodes not at all. The camera also stayed live through the whole naming step,
pointed at an object that is not a label; it now switches off the moment there
is a photo.

**Speed.** Enrolling one item while packing cost about thirteen network round
trips, one after another. It is three now, and the slowest of the old ones — the
photo upload — happens while the name is being typed:

| | before | after |
|---|---|---|
| photo + thumbnail upload | 2, serial, at Save | starts at the shutter, both at once |
| create the thing | 1 insert + 1 event | unchanged |
| put it in the box | read, read, update, event | none — the row is inserted already inside the box |
| the box's name | re-read on every scan | held; re-read when the box changes |
| the box's contents count | every row, before the banner drew | a count, after |
| the pick-list | every row, before the viewfinder | every row, after |

If the database refuses the parent, the item is still enrolled — loose, with a
warning. Losing the thing because the box was wrong is the worse failure.

**Layout.** The viewfinder stayed at full height after the shutter, so the name
field and the buttons were pushed under the keyboard. The picture now sits
beside the name field, and everything fits on one screen with the keyboard up.

Also: a failed event-log write used to go only to the console. It is a hole in
the one record that cannot be rebuilt later, so it says so on screen now.

---

## Still open

1. **The printed labels have never been scan-tested.** Four sheets are printed
   (`2222` … `22A5`). Stick five, scan them in the worst light you will actually
   work in. Modules are 0.551 mm against the 0.72 mm the brief assumed; if they
   fail, the three fallbacks are in [LABELS.md](LABELS.md) under *QR size*.
2. **Camera + text problems** — item 6, still undescribed.
3. **A photo can only be taken during enrolment.** Retaking during enrolment now
   works, but once the item is saved there is no way back to the camera. Edit
   should take one.
4. **Unpacking at the far end** is only half-supported: **Empty** takes
   everything out of a box, but there is no "tick items off as they come out".
5. **Supabase free projects pause after about a week idle.** Over a multi-week
   move this will happen: the app shows "No connection to the catalog" and it
   takes a click in the Supabase dashboard to wake. Not a bug, but it will look
   like one at the worst moment.
6. **The catalog view fetches every row on each refresh.** Fine at 260 labels
   (~100 kB); past a couple of thousand it wants pagination.
7. **Photos are readable by URL without signing in.** The storage bucket answers
   without a token, which is what lets `<img src>` work without threading a
   signed URL through every view and refreshing it mid-session. What keeps them
   private is that the paths are unguessable and the only record of them is in
   the `things` row, which now needs a session to read. A leaked URL is still a
   leaked photo. The fix is `createSignedUrl` at render time; it touches five
   files and the backup exporter, and it was not worth it for a house move.
8. **One shared password means no per-person revoke.** Losing a phone means
   changing the password for everybody. Individual accounts would fix it and
   would also make `events.actor` unforgeable, at the cost of an email round
   trip per helper — Supabase's built-in SMTP allows a few sends an hour on the
   free tier. Worth it for a team; not for four friends and a van.
