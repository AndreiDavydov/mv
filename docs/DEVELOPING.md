# Developing

Running it, testing it, and how the code is arranged.

---

## Quick start

```bash
npm install
npm run vendor          # bundles the npm deps into /vendor (output is committed)
npm test                # 129 unit tests — pure rules, no browser, no network
npm run serve           # http://localhost:8087/labels/  and  /app/
```

There is **no build step for the site itself**. `vendor/` holds the bundled
dependencies as plain ESM and is committed, so GitHub Pages serves the repo as
it stands. Re-run `npm run vendor` only when a dependency changes.

Live: **https://andreidavydov.github.io/mv/app/**

## Scripts

| script | what it does |
|---|---|
| `npm test` | unit tests — pure rules, no browser, no network (129, ~0.2 s) |
| `npm run test:live` | everything needing the database, browsers included (67, ~2 min). Needs `CREW_PASSWORD` in the environment |
| `npm run test:all` | both |
| `npm run serve [port]` | static dev server; `localhost` is a secure context, so `getUserMedia` behaves as it does on Pages |
| `npm run vendor` | bundle `qrcode`, `jsqr`, `fflate`, `supabase-js` into `/vendor` |
| `npm run proofs` | label sheets and calibration PDFs — see [LABELS.md](LABELS.md) |
| `npm run shots` | screenshot every screen at phone size into `proofs/screens/` |
| `npm run demo` | the mock scan test, below |

## The mock scan test

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

## Scanning with your phone

Open the site on the laptop, point the phone's normal camera at
`proofs/label-on-box.png`, and the catalog opens on the phone at that ID —
asking what the thing is if it has never been seen, showing its details if it
has. Whatever the phone saves appears on the laptop without a reload.

To point a test label at a dev server instead of the deployed site, see
[LABELS.md](LABELS.md).

## Layout

```
config.js              BASE_URL, ID alphabet, crew email, container kinds
shared/                used by both deliverables
  ids.js               sequential 4-char IDs, normalisation, typo repair
  payload.js           build a Format A payload; resolve any scan to an ID
  qr-svg.js            QR → SVG, and measure() for what a payload actually costs
labels/                DELIVERABLE 1 — open index.html, print
  sheets.js            sheet geometry as data
supabase/              schema and migrations
app/                   DELIVERABLE 2 — the catalog
  src/core/            no DOM, no network:
    capabilities.js      what a thing may do — asked by the buttons AND the writes
    model.js             the rules: what an event records, which action undo reverses
    machine.js           the scan state machine
    auth.js              who is allowed in, and whose name goes on an event
    remote.js            the same surface as model, resolving against Postgres
    search.js  backup.js
  src/platform/        camera, decode, tones, image downscaling, files
  src/ui/              a 100-line DOM helper, components, views, controller
  sw.js                a tombstone: unregisters itself and clears old caches
vendor/                bundled dependencies (committed)
proofs/                printable artefacts, screenshots, the printed-labels ledger
backups/               where exported bundles get committed
```

The split that matters is `core/model.js` versus `core/remote.js`. The rules
that are easy to get wrong — what an event records, which action undo should
reverse, what a thing may do — are plain data transformations with no storage
attached, so they stay testable in milliseconds. `remote.js` only executes them
against Postgres.

**No service worker.** The catalog is shared, so the app needs the network
anyway, and a cached shell means a device keeps running whatever build it first
saw — which cost a real afternoon when a phone kept writing into a dead
IndexedDB. `app/sw.js` is now a tombstone that clears caches, unregisters itself
and reloads. **It must stay deployed**: deleting the file would not help,
because a browser keeps the worker it already has.

## Testing

Two suites, and the split is deliberate.

**`npm test` — 129 unit tests, no browser, no network, ~0.2 s.** The rules: the
scan state machine, undo selection, search ranking, id handling, capabilities,
sheet geometry, the auth helpers. Fast enough to run on every save.

Two of them are worth knowing about:

- `test/roundtrip.test.js` rasterises the generator's own SVG and decodes it with
  the same jsQR build the app ships. If the generator and the scanner ever
  disagree, that breaks in Node rather than on 65 stickers.
- `test/auth.test.js` fails if any policy in `schema.sql` or
  `migration-005-auth.sql` ever names `anon` again. `schema.sql` is documented as
  safe to re-run, so a stray anon policy in it would silently reopen the catalog.

**`npm run test:live` — 67 tests against the real Supabase project, ~2 min.**
Browsers driven by puppeteer against installed Chrome. Needs `CREW_PASSWORD`.

The catalog is shared and live, so these can never wipe it: each file owns a
reserved block of ids at the end of the space (`ZZ2*` … `ZZ7*`) and clears only
those. The log is append-only and cannot be cleared at all, so each file records
a watermark and ignores everything written before it. They run with
`--test-concurrency=1` because two files racing on one database is not a test of
anything.

`test/live/camera.live.js` feeds Chrome an ffmpeg-generated Y4M of a rendered
label as a fake camera device. The decode loop, the cooldown and the enrol
chaining are all the real ones — that suite is what caught a sticker packing
itself three times.

## Acceptance tests from the brief

Every box in [HANDOVER.md §13](HANDOVER.md) except the one that needs paper:

| acceptance test | where |
|---|---|
| Print a sheet; 5 labels scan first-try in dim light | **not run** — needs paper. See [LABELS.md](LABELS.md) |
| A scan on one device appears on another, no reload | `test/live/shared.live.js` |
| Nothing is stored on the scanning device | `test/live/shared.live.js` |
| A pack on the phone updates the box open on the laptop | `test/live/shared.live.js` |
| A described item shows details instead of asking again | `test/live/shared.live.js` |
| Enrol 10 unknown items | `test/live/app.live.js` |
| PACKING: scan 5 items, scan the box, all 5 appear | `test/live/app.live.js` |
| An item in Box A while packing Box B moves silently; log shows `unpacked` + `packed` | `test/live/remote.live.js` |
| Undo reverses the last pack, and a move as one action | `test/live/remote.live.js` + `test/model.test.js` |
| The history cannot be deleted, only appended to | `test/live/remote.live.js`, `test/live/gate.live.js` |
| A container cannot be put inside itself | `test/live/rules.live.js` (Postgres trigger) |
| Typing a code by hand resolves like scanning it | `test/live/app.live.js` |
| Airplane mode | **no longer applicable** — a shared catalog needs the network |

## Deploying

Push to `main`. GitHub Pages rebuilds in about a minute; there is nothing to
build. The repo root carries a forwarder so `/mv/` reaches `/mv/app/`.

`BASE_URL` in `config.js` has its scheme and host uppercase, because an
uppercase run encodes in QR alphanumeric mode instead of byte mode (~40%
denser), and hostnames are case-insensitive. **The path stays in its real
case** — GitHub Pages serves `/mv/` and 404s on `/MV/`. The generator refuses to
print a sheet from an uppercase path.
