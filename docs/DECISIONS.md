# Decisions

Where the build departs from [HANDOVER.md](HANDOVER.md), and why. Also the
questions the brief left open (§14) and what was assumed in their place.

---

## The catalog is shared, not device-local

The brief specifies a single-user, offline-first app: IndexedDB as the source of
truth, "no backend, no auth, no sync" (§1, §11). That was built, and then
replaced on request — the point of the catalog turned out to be that friends
helping with the move can see it.

It is now one Postgres database on Supabase, with every open screen subscribed
to it. A scan on a phone appears on a laptop immediately, and nothing is stored
on the scanning device but which box that person is currently filling.

Everything else in the brief survived: the label format, the ID scheme, the scan
state machine, the event log, the acceptance tests. Two things did not:

- **No offline mode.** Writes fail loudly with a red banner instead of queueing.
  A pack that silently lands ten minutes later is worse than being told to move
  two metres.
- **IndexedDB is gone entirely**, and with it two workarounds the brief's
  storage layer had required — a fourth object store for the backup nag, and a
  `container_flag` mirror of `is_container` (IndexedDB cannot index a boolean).
  Postgres needs neither.

The event log was already shaped so this could be additive, which is the only
reason the change was days rather than a rewrite.

## The catalog is private, and the lock is in the database

A later addition, not in the brief at all — which assumed a single user with no
account. Everyone helping shares one password, and `anon` holds no privilege on
anything. Full reasoning in [ACCESS.md](ACCESS.md).

## QR size: 16.0 mm, not 18–19 mm

The brief asks for a ~19 mm QR *and* a 4-module quiet zone *and* this sheet
format. Those three cannot hold together — the arithmetic and the three
fallbacks are in [LABELS.md](LABELS.md).

## The sheet geometry came from a scan, not a datasheet

The brief gives nominal L7651 figures and says *do not trust these*, which was
the right instinct: they describe a different sheet. Measured values and how
they were confirmed are in [LABELS.md](LABELS.md).

## jsQR instead of zxing-wasm / html5-qrcode

`BarcodeDetector` is still the primary decoder, feature-detected. For the
fallback, jsQR is 128 kB of plain JS with no wasm asset to fetch and no UI of
its own, against roughly a megabyte plus a wasm file for zxing. For a decoder
that only has to turn an ImageData into a string, the smaller one wins.
Swapping it is one file, `app/src/platform/scanner.js`.

## Export is one ZIP, not three files

The bundle holds `catalog.json`, `catalog.csv` and `photos/<ID>.jpg` — all three
artefacts, one tap, one file. They are only useful together, and a three-file
export is a three-file restore. A bare `catalog.json` also imports, for the case
where the photos are gone.

## Only the camera loop is rate-limited

The brief asks for a 2000 ms cooldown on repeat reads of the same ID. Applied to
every source, it broke the primary flow: a phone's stock camera opening a label
URL lands on the router, not the in-app scanner, and was going through the same
cooldown. Scan a label, back out, scan it again within two seconds, and the app
did nothing at all.

The cooldown exists for exactly one reason — a continuous decoder firing thirty
times a second at one unmoving label. Every other source is a deliberate act, so
`decideScan` takes a `source` and only rate-limits `'camera'`.

## A mode change clears the cooldown

The same cooldown swallowed the *deliberate* second scan in the most common
sequence there is: enrol an item, tap "Pack into this", scan that same item.
Changing mode now resets it.

## The cooldown is claimed before the row is fetched

Found once the camera suite could run again: one sticker held in front of the
camera produced *three* `packed` entries. The decode loop does not await the
scan handler — the next frame is read as soon as the previous one has been — so
three frames sat inside `scan()` at once, all holding the same session, all
fetching a row that still said "not packed yet", and all deciding to pack it.
The cooldown was stamped after that fetch, a network round trip too late to
guard anything.

`isRepeatScan()` is the same rule `decideScan` uses, split out so `app.scan()`
can ask it and stamp the session synchronously, before its first await. It
matters more than it would have: a duplicate written into an append-only log
stays written.

## `shared/` exists

`ids.js`, `payload.js` and `qr-svg.js` are used by both deliverables. Having
`labels/` import out of `app/src/` would make the standalone label page depend
on the app; a sibling directory alongside `config.js` says what is actually
true.

## Rules live in one module, not in the buttons

Not asked for, and added after an audit turned up four ways to reach a state the
model said was impossible — a `gone` container that kept its contents, a pack
that silently resurrected a deleted thing, `status` and `parent_id` disagreeing.

`app/src/core/capabilities.js` answers "what may this thing do" for both the
buttons and the writes, so a button is never offered for something the write
will refuse, and the database backs every rule with a constraint or a trigger.
The audit is [STATES.md](STATES.md).

---

## The brief's open questions (§14)

**Repo name and GitHub username.** `HTTPS://ANDREIDAVYDOV.GITHUB.IO/mv/app`,
confirmed and printed. `BASE_URL_CONFIRMED = true` in `config.js`; while it was
false the generator refused to print Format A sheets, which is what stopped a
guessed URL from reaching paper.

**Room list — fixed vocabulary or free text?** Neither, in the end. It was built
as a fixed vocabulary of chips, and then removed: nobody filled the field during
an actual pack, so it was noise on the fastest screen in the app. `ROOMS` is an
empty array and the `room` column stays — dropping it is a migration, restoring
the UI is a few lines.

**Should `status = 'gone'` be reachable from the main flow?** Yes, reachable but
not on the scan path. A **Gone** button on the thing detail, behind one
confirmation. It releases the contents first if it is a container, sets
`parent_id = null`, keeps the row and the name, and writes a `deleted` event —
so the catalog stays honest after the move instead of quietly losing whatever
left. Gone things show struck through and tagged, and are excluded from the
packing pick-list.

---

## Not built, on purpose

Per §11: no voice control, no EAN lookup, no valuation, no native app. Two of
the original non-goals no longer hold — there is a backend, and there is an
account — because the requirement changed.

One gap that is a gap rather than a decision: **undoing the enrolment of a
container that already has contents** leaves those contents pointing at a
deleted parent. Undo only ever reverses the newest action, so this needs a
container enrolled, filled, and then undone as the very next step.

The second sheet format (Zweckform 3474) is a data entry in `labels/sheets.js`,
as the brief specified. It has not been added.
