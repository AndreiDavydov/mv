# Build notes

Implementation of [README.md](README.md). This file covers how to run it, what
was verified, and every place the build departs from the handover — with the
reason.

---

## Quick start

```bash
npm install
npm run vendor          # bundles the 4 npm deps into /vendor (output is committed)
npm test                # 87 unit tests, no browser
npm run test:e2e        # 20 browser tests: real IndexedDB, real camera, real service worker
npm run serve           # http://localhost:8087/labels/  and  /app/
```

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

### Scanning with your phone, before the site is deployed

The intended flow is a phone's stock camera reading the label and opening the
catalog at that ID. That only works once `BASE_URL` resolves to something real —
until GitHub Pages is up, the printed URL is a 404.

To test the flow today, generate a label pointing at the dev server's LAN
address instead:

```bash
npm run serve                                            # binds all interfaces
npm run proofs -- --no-sheet --base=http://<LAN-IP>:8087/app
```

That writes `proofs/label-on-box-lan.png`. Show it on the laptop, scan it with
the phone camera, and the catalog opens on the phone at `#K7M3`. Over plain HTTP
the phone gets no service worker and no in-app camera — the enrol screen falls
back to the OS camera picker — but the enrol, pack and search loops all work.

**Never print a sheet from an overridden base.** The override exists for this
one screen test.

### Scripts

| script | what it does |
|---|---|
| `npm run vendor` | bundle `qrcode`, `idb`, `jsqr`, `fflate` into `/vendor` as plain ESM |
| `npm test` | unit tests (node:test + fake-indexeddb) |
| `npm run test:e2e` | browser tests (puppeteer-core driving the installed Chrome) |
| `npm run test:all` | both |
| `npm run serve [port]` | static dev server; `localhost` is a secure context, so `getUserMedia` and service workers behave as on Pages |
| `npm run proofs` | full-scale A4 sheet PDF + a single label rendered on a box |
| `npm run shots` | screenshot every screen at phone size into `proofs/screens/` |
| `npm run demo` | the mock scan test, above |

---

## Layout

```
config.js              BASE_URL, ID alphabet, rooms, container kinds, nag thresholds
shared/                used by both deliverables
  ids.js               sequential 4-char IDs, normalisation, typo repair
  payload.js           build a Format A payload; resolve any scan to an ID
  qr-svg.js            QR → SVG, and measure() for what a payload actually costs
labels/                DELIVERABLE 1 — open index.html, print
  sheets.js            sheet geometry as data
app/                   DELIVERABLE 2 — the PWA
  src/core/            no DOM, no browser: db, repo, machine, search, backup
  src/platform/        camera, decode, tones, image downscaling, files
  src/ui/              a 100-line DOM helper, components, views, controller
  sw.js                precaches the shell
vendor/                bundled dependencies (committed; regenerate with npm run vendor)
proofs/                printable artefacts + screenshots
backups/               where exported bundles get committed
```

The split that matters is `core/` versus everything else. `core/` is pure data
and rules — no DOM, no camera, no network — which is why the state machine, the
event log and the undo semantics are all testable in Node in milliseconds.

---

## Verified

Every box in README §13 except the one that needs a real printer:

| acceptance test | where |
|---|---|
| Print an item sheet; 5 labels scan first-try | **not run** — needs paper. `proofs/sheet-2222.pdf` is ready; see *QR size* below |
| Enrol 10 unknown items | `test/e2e/acceptance.e2e.js` |
| PACKING: scan 5 items, scan the box, all 5 appear | `test/e2e/acceptance.e2e.js` |
| Item in Box A while packing Box B moves silently, log shows `unpacked` + `packed` | `test/e2e/acceptance.e2e.js` |
| Undo reverses the last pack | `test/e2e/acceptance.e2e.js` + `test/undo.test.js` |
| Airplane mode, reload, full enrol + pack loop | `test/e2e/acceptance.e2e.js` (service worker + `setOfflineMode`) |
| Export, wipe, import — catalog and photos intact | `test/e2e/acceptance.e2e.js` |
| Typing a code by hand resolves like scanning it | `test/e2e/smoke.e2e.js` |

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
