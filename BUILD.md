# Build notes

Implementation of [README.md](README.md). This file covers how to run it, what
was verified, and every place the build departs from the handover — with the
reason.

---

## Where this stands

| | |
|---|---|
| Live | https://andreidavydov.github.io/mv/app/ |
| Database | Supabase `sqwbpeltdjyjrclrgejp`, migrations 002, 003, 004 and 005 applied |
| Access | **private** — one shared password, `anon` holds nothing (see *Who gets in*) |
| Catalog | empty — the test rows were cleared before the first real print |
| Labels printed | **4 sheets, 260 labels, `2222` … `22A5`** |
| Next free code | **`22A6`** — `npm run proofs -- --sheets=N` starts there by itself |
| Tests | 129 unit (~0.2 s) · 67 live (~2 min, needs `CREW_PASSWORD`) |

**The label sheet geometry was measured, not looked up.** The pack is Avery
QuickPEEL 38 × 21.2, and its grid is *not* Avery L7651's: the columns butt
together at 38.0 mm with 10 mm side margins, where L7651 has 2.5 mm alleys on a
40.6 pitch. Using the published figures put every column after the first in the
wrong place. The figures in `labels/sheets.js` come from a 600 dpi scan of the
sheet with its four corner labels peeled off, and three tests in
`test/sheets.test.js` hold them to it.

**What has never been tested:** whether the printed labels actually scan.
Modules are 0.551 mm against the 0.72 mm the brief assumed. Everything else is
verified; that is not. See *QR size* below for the fallbacks.

### Who gets in

The catalog is private, and the lock is in Postgres rather than in the app.

`anon` — the role every browser gets from the public key in `config.js` — holds
no privilege on any table. A stranger who scans a box reaches a locked page, and
behind it the database returns zero rows to anything they ask. That distinction
is the whole design: a password checked in JavaScript would have been worth
nothing, because the key is printed in a file served from the same site and the
REST API answers `curl` just as happily as it answers the app.

Everyone helping shares **one account and one password**. The email address in
`CREW_EMAIL` is the account's name, not a mailbox — the app fills it in, so a
helper only ever types the password. Signing in once per device is the whole
ceremony; the session survives a locked phone.

Two settings live in the Supabase dashboard rather than in SQL, and the second
one is load-bearing:

1. **Authentication → Users → Add user** — the crew account, with Auto Confirm
   ticked.
2. **Authentication → Sign In / Providers → Email → "Allow new users to sign
   up": OFF.** With signups on, anyone holding the public key calls `signUp()`,
   becomes `authenticated`, and every policy waves them through. `gate.live.js`
   asserts this from a browser that has never signed in.

Changing the password on that user is the entire revocation story: everyone
re-enters it once, and nobody's work is orphaned, because who did what is
recorded by **name** in the event log rather than by account.

### What cannot be erased

The shared password means the database cannot tell helpers apart, so the event
log carries a name typed at sign-in. That name is not a credential — it buys no
access — and it is worth something only because the log cannot be edited.

`events` has exactly two policies, `select` and `insert`. There is no update
policy and no delete policy, and RLS denies what it was not told to allow. So
"someone does something, then cleans up after themselves" is not a thing that
can happen here: not through the app, not through the console, not with the key
in hand. Deleting a *thing* is allowed — but `events` carries no foreign key to
`things`, so the row going away leaves `enrolled ZZ4B "espresso machine"` and
`deleted ZZ4B` standing in the log with a name on them.

The one exception is `public.retire_code()`, which is `SECURITY DEFINER`
precisely so that reassigning a label can move a record's events to its new id.
It renames; it deletes nothing.

Photos got the same treatment. Their storage paths used to be `<ID>.jpg` — and
the ID is printed on the outside of the box, so any photo's URL was derivable by
anyone who had seen a label, which no login could have fixed. They are now
`<ID>-<random>.jpg`, the random half exists only in the `things` row, and the
bucket takes inserts but no updates or deletes: re-photographing something adds
a file and leaves the previous one where it was.

Admin power is deliberately *not* an in-app role. It is the Supabase dashboard
and the service-role key, which one person holds and no password shared with
four people can reach.

Open items are in [BACKLOG.md](BACKLOG.md); the state-space audit and the rules
model are in [STATES.md](STATES.md).

### Which codes have been printed

`proofs/printed.json` is the ledger, committed with the code. The labels page
keeps the same counter in the browser, but sheets generated from the command
line never touch the browser — so without this, nothing stopped two boxes
answering to the same code. Generating refuses a code already recorded; `--mark`
records a range once it has actually printed, because a sheet that jammed has
not consumed anything.

---

## Quick start

```bash
npm install
npm run vendor          # bundles the npm deps into /vendor (output is committed)
npm test                # 129 unit tests — pure rules, no browser, no network
CREW_PASSWORD=... \
  npm run test:live     # 67 tests against the real Supabase project, including
                        #   two isolated browsers proving one sees the other's scan,
                        #   and a third that has never signed in proving it sees nothing
npm run serve           # http://localhost:8087/labels/  and  /app/
```

Live: **https://andreidavydov.github.io/mv/app/**

### The mock scan test

```bash
npm run demo            # a Chrome window whose camera plays proofs/label-on-box.png
npm run demo -- --auto  # same, headless, types a description and prints the DB rows
```

`--auto` prints exactly what lands in the database:

```
  scanned     K7M3  — unknown code, ENROLL opened by itself
  described   "Cast iron pan"

  things ─────────────────────────────────────────
  │ id     │ name            │ status     │ parent_id │
  │ 'K7M3' │ 'Cast iron pan' │ 'unpacked' │ null      │

  events ─────────────────────────────────────────
  │ thing_id │ type       │ id │
  │ 'K7M3'   │ 'enrolled' │ 1  │
```

### Scanning with your phone

Open **https://andreidavydov.github.io/mv/app/** on the laptop, point the phone's
normal camera at `proofs/label-on-box.png`, and the catalog opens on the phone at
that ID — asking what the thing is if it has never been seen, showing its details
if it has. Whatever the phone saves appears on the laptop without a reload.

To point a test label at a dev server instead of the deployed site:

```bash
npm run serve                                            # binds all interfaces
npm run proofs -- --no-sheet --base=http://<LAN-IP>:8087/app
```

**Never print a sheet from an overridden base.** The override exists for screen
tests only.

### Scripts

| script | what it does |
|---|---|
| `npm run vendor` | bundle `qrcode`, `jsqr`, `fflate`, `supabase-js` into `/vendor` as plain ESM |
| `npm test` | unit tests — pure rules, no browser, no network (129, ~0.2s) |
| `npm run test:live` | everything that needs the database, browsers included (67, ~2min). Needs `CREW_PASSWORD` in the environment — the catalog requires a sign-in, and the password is not in the repo |
| `npm run test:all` | both |
| `npm run serve [port]` | static dev server; `localhost` is a secure context, so `getUserMedia` and service workers behave as on Pages |
| `npm run proofs` | label sheets + calibration PDFs (`--sheets=N`, `--dx/--dy` nudge, `--sweep`, `--mark`) |
| `npm run shots` | screenshot every screen at phone size into `proofs/screens/` |
| `npm run demo` | the mock scan test, above |

---

## Architecture

One shared database. The site on GitHub Pages is static; all state lives in
Postgres, and every open screen subscribes to it.

```
   phone                    laptop                 anyone's browser
     │                        │                          │
     └────────────┬───────────┴──────────────────────────┘
                  │  supabase-js  (REST + realtime socket)
                  ▼
        ┌───────────────────────────────────┐
        │  things   current state           │
        │  events   append-only history     │
        │  storage  photos/<ID>.jpg         │
        └───────────────────────────────────┘
```

- A scan resolves the label URL, which opens the app at `#ID` on that device.
- Unknown code → it asks what the thing is. Known code → it shows the details.
- Whoever answers, the write goes to Postgres, and **every** open screen redraws.
- The scanning device stores nothing but which box it is currently packing —
  that is per-person, so two helpers can fill two boxes at once.

**No offline mode.** A shared catalog needs the network. Writes fail loudly with
a red banner rather than queueing: a pack that silently lands ten minutes later
is worse than being told to move two metres.

**Anyone with the link can read and write.** That is what lets a helper open a
URL and start working. The anon key is a shared password inside a public site.
For a house move that is the right trade; `supabase/schema.sql` documents the
one-line change to require sign-in instead.

## Database migrations

Run in order, in the Supabase SQL editor. All are idempotent and repair rows
already in a bad state, so re-running one is harmless.

| file | what it does |
|---|---|
| `supabase/schema.sql` | the tables, the cycle guard, realtime, access rules, the photo bucket |
| `supabase/migration-002-integrity.sql` | `packed ⟺ in a box`; retired-label ids; contents follow a rename |
| `supabase/migration-003-rules.sql` | only an open container can contain; a kind belongs to a container; the one function allowed to touch the append-only log |
| `supabase/migration-004-delete-fix.sql` | a box may be deleted *with* its contents, never out from under them |
| `supabase/migration-005-auth.sql` | closes the catalog: `anon` loses every privilege, one shared account replaces it. **Its header names two dashboard settings that are not SQL — without them this file achieves nothing** |

The live tests skip themselves by name when a migration is missing, rather than
failing or — worse — passing.

## Layout

```
config.js              BASE_URL, ID alphabet, rooms, container kinds, nag thresholds
shared/                used by both deliverables
  ids.js               sequential 4-char IDs, normalisation, typo repair
  payload.js           build a Format A payload; resolve any scan to an ID
  qr-svg.js            QR → SVG, and measure() for what a payload actually costs
labels/                DELIVERABLE 1 — open index.html, print
  sheets.js            sheet geometry as data
supabase/schema.sql    the shared database: tables, triggers, access rules, bucket
app/                   DELIVERABLE 2 — the app
  src/core/            no DOM, no network:
    capabilities.js      what a thing may do — asked by the buttons AND the writes
    model.js             the rules: what an event records, which action undo reverses
    machine.js           the scan state machine
    remote.js            the same surface, resolving against Postgres
    search.js  backup.js
  src/platform/        camera, decode, tones, image downscaling, files
  src/ui/              a 100-line DOM helper, components, views, controller
  sw.js                caches the shell, network-first
vendor/                bundled dependencies (committed; regenerate with npm run vendor)
proofs/                printable artefacts + screenshots
backups/               where exported bundles get committed
```

The split that matters is `core/model.js` versus `core/remote.js`. The rules that
are easy to get wrong — what an event records, which action undo should reverse —
are plain data transformations with no storage attached, so they stay testable in
milliseconds. `remote.js` only executes them against Postgres.

---

## Verified

Every box in README §13 except the one that needs a real printer:

| acceptance test | where |
|---|---|
| Print an item sheet; 5 labels scan first-try | **not run** — needs paper. `proofs/sheet-2222.pdf` is ready; see *QR size* below |
| A scan on one device appears on another, no reload | `test/live/shared.live.js` |
| Nothing is stored on the scanning device | `test/live/shared.live.js` |
| A pack on the phone updates the box open on the laptop | `test/live/shared.live.js` |
| A described item shows details instead of asking again | `test/live/shared.live.js` |
| Enrol 10 unknown items | `test/e2e/acceptance.e2e.js` |
| PACKING: scan 5 items, scan the box, all 5 appear | `test/e2e/acceptance.e2e.js` |
| Item in Box A while packing Box B moves silently, log shows `unpacked` + `packed` | `test/live/remote.live.js` |
| Undo reverses the last pack, and a move as one action | `test/live/remote.live.js` + `test/model.test.js` |
| The history cannot be deleted, only appended to | `test/live/remote.live.js` |
| A container cannot be put inside itself | `test/live/remote.live.js` (Postgres trigger) |
| Photos upload and are readable with no key | `test/live/remote.live.js` |
| Typing a code by hand resolves like scanning it | `test/e2e/smoke.e2e.js` |
| Airplane mode | **no longer applicable** — a shared catalog needs the network |

Two extra loops worth knowing about:

- **`test/roundtrip.test.js`** rasterises the generator's own SVG and decodes it
  with the same jsQR build the app ships. If the generator and the scanner ever
  disagree, that breaks in Node rather than on 65 stickers.
- **`test/e2e/camera.e2e.js`** plays a video of the rendered label into Chrome as
  a camera device. The decode loop, the cooldown and the enrol chaining are all
  the real ones.

---

## Departures from the handover

### QR size: 16.0 mm, not 18–19 mm

The handover asks for a ~19 mm QR *and* a non-negotiable 4-module quiet zone
*and* the Zweckform 3666 format. Those three cannot hold together.

Labels on this sheet touch vertically (pitch 21.2 mm = label height 21.2 mm), so
the neighbouring label's ink is the boundary: the symbol **plus** its quiet zone
has to fit inside 21.2 mm. With a 25×25 symbol that is `S × 33/25 ≤ 21.2`, so
`S ≤ 16.1 mm`. A 19 mm symbol would need 25 mm of label.

The real payload is also bigger than the handover assumed.
`HTTPS://ANDREYDAVYDOV.GITHUB.IO/MOVING/#K7M3` is 44 characters, which is QR
**version 3** (29×29), not version 2 — version 2 at ECC-M tops out at 38
alphanumeric characters.

So the generator measures instead of assuming: it reads the real version off the
encoder, derives the module size from the label height, and shows the number.
Current figures:

| payload | version | symbol | module |
|---|---|---|---|
| Format A URL, ECC M | 3 | 16.0 mm | **0.551 mm** |
| Format B bare ID, ECC M | 1 | 14.8 mm | **0.703 mm** |

0.55 mm modules are workable for a phone at 20–40 cm but are below the 0.72 mm
the handover expected. **Print the test strip first.** If those labels fail the
dim-light test, the generator has three fixes built in, in order of preference:

1. switch the payload to Format B (bare ID) — 0.70 mm modules, but no
   stock-camera deep link;
2. drop to ECC L;
3. shorten `BASE_URL` — under 33 characters brings Format A back to version 2.

### jsQR instead of zxing-wasm / html5-qrcode

`BarcodeDetector` is still the primary decoder, feature-detected. For the
fallback, jsQR is 128 kB of plain JS with no wasm fetch and no UI of its own,
against roughly a megabyte plus a wasm asset to precache for zxing. For a
service worker that has to work in airplane mode, and a decoder that only needs
to turn an ImageData into a string, the smaller one wins. Swapping it is one
file (`app/src/platform/scanner.js`).

### A fourth object store, `meta`

The handover specifies `things`, `events`, `session`. The backup nag needs to
remember when the last export happened and at which event count; that is not
catalog data and does not belong in `session`. It is a two-column key/value
store and nothing else uses it.

### `container_flag` alongside `is_container`

IndexedDB keys may only be numbers, strings, dates, binaries or arrays — a
boolean cannot be indexed, so the requested index on `is_container` cannot exist
directly. `is_container` stays a boolean in the data model; `container_flag`
mirrors it as 0/1 purely so the index works. The repo maintains both on every
write and nothing outside `db.js`/`repo.js` reads the mirror.

### Export is one ZIP, not three files

The bundle contains `catalog.json`, `catalog.csv` and `photos/<ID>.jpg` — all
three artefacts, one tap, one file. They are only useful together, and a
three-file export is a three-file restore. A bare `catalog.json` also imports,
for the case where the photos are gone.

### Only the camera loop is rate-limited

Also found by the acceptance tests, and it broke the primary flow: a phone's
stock camera opening the label URL lands on `#route()`, not on the in-app
scanner — and it was going through the same 2000 ms cooldown. Scan a label,
back out, scan it again within two seconds, and the app did nothing at all.

The cooldown exists for one reason: a continuous decoder firing thirty times a
second at one unmoving label. Every other source — a deep link, a typed code, a
ring-scanner trigger — is a deliberate act, so `decideScan` now takes a `source`
and only rate-limits `'camera'`. Regression tests: `test/machine.test.js`
("only the continuous camera loop is rate-limited") and the three cold `#ID`
tests in `test/e2e/smoke.e2e.js`.

### A mode change clears the scan cooldown

Found by the acceptance tests. The 2000 ms cooldown exists so a continuous
decoder does not fire thirty times at one unmoving label — but it also swallowed
the *deliberate* second scan in the most common sequence there is: enrol an item,
tap "Pack into this", scan that same item. Changing mode now resets the cooldown.
Regression test: `test/machine.test.js`, "changing mode clears the cooldown".

### The cooldown is claimed before the row is fetched

Found by `camera.live.js` once it could run again: one sticker held in front of
the camera produced *three* `packed` entries. The decode loop does not await the
scan handler — the next frame is read as soon as the previous one has been — so
three frames were inside `scan()` at once, all holding the same session, all
fetching a row that still said "not packed yet", and all deciding to pack it.
The cooldown was stamped after that fetch, which is a network round trip too
late to guard anything.

`isRepeatScan()` is the same rule `decideScan` uses, split out so `app.scan()`
can ask it and stamp the session synchronously, before its first await. It
matters more now than it did: the event log cannot be tidied up afterwards, so a
duplicate written into it stays written.

### `shared/` exists

`ids.js`, `payload.js` and `qr-svg.js` are used by both deliverables. Having
`labels/` import out of `app/src/` would make the standalone label page depend on
the app; a sibling directory alongside `config.js` says what is actually true.

---

## Open questions from README §14 — what was assumed

**Repo name and GitHub username.** Guessed as
`HTTPS://ANDREYDAVYDOV.GITHUB.IO/MOVING`, and deliberately fenced: `config.js`
also exports `BASE_URL_CONFIRMED = false`, and while that is false the generator
**refuses to print Format A sheets** (calibration sheets and test strips still
print). A red banner explains why.

> **Before printing anything: open `config.js`, fix `BASE_URL`, set
> `BASE_URL_CONFIRMED = true`.** Changing it later kills every label already
> stuck to a box. Shorter is better — see *QR size* above.

**Room list.** Fixed vocabulary in `config.js`, so the same place is spelled the
same way every time and enrolment is one tap. The edit screen has an `Other…`
chip that adds a one-off, and any room already in use shows up as a chip
afterwards. Change the list in one place.

**`status = 'gone'`.** Reachable from the main flow — a `Gone` button on the
thing detail, behind one confirmation. It sets `parent_id = null`, keeps the row
and the name, and writes a `deleted` event, so the catalog stays honest after the
move instead of quietly losing the things that left. It is not on the scan path,
so it cannot happen by accident.

---

## Things deliberately not built

Per README §11: no sync, no accounts, no backend, no voice, no EAN lookup, no
valuation, no native app. The event log is shaped so sync *could* be added
additively; nothing is designed for it.

Not yet covered, and worth knowing:

- **Undoing the enrolment of a container that already has contents** leaves those
  contents pointing at a deleted parent. Undo only ever reverses the newest
  action, so this needs a container enrolled and filled and then undone as the
  very next step. It is a real gap, not a designed behaviour.
- **The second sheet format** (Zweckform 3474) is a data entry in
  `labels/sheets.js`, as specified. It has not been added.
