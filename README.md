# HANDOVER — QR Home Inventory & Packing Catalog

## 0. Context

I am moving flat. I want a **permanent item-level catalog** of my possessions that
also handles the move itself. Physical QR labels get stuck on everything; my phone
is the scanner; a static web app hosted on GitHub Pages is the whole system.

The catalog must outlive the move. The packing feature is a mode on top of a
general-purpose inventory, not the point of the system.

**Two deliverables, in this order:**

1. **`labels/`** — a label sheet generator (standalone HTML page → print to PDF).
   Needed immediately so I can print and stick labels before the app exists.
2. **`app/`** — the catalog PWA.

Build deliverable 1 completely and verify it before starting deliverable 2.

---

## 1. Hard principles

- **Offline first.** Enrollment happens in cellars and stairwells with no signal.
  Nothing in the core loop may depend on the network.
- **Speed per item is the design metric.** Target: under 10 seconds from scan to
  "item is enrolled and in my hand ready to pack." Every extra tap kills the project.
- **The scan is the primary verb.** The current mode determines what a scan means.
  No menu diving.
- **Local-only, single user.** IndexedDB is the source of truth. No backend, no auth,
  no sync. See §11 for why this must not be designed around.
- **Data must be exportable and human-readable.** JSON + CSV + photos, one tap.

---

## 2. Physical setup (fixed — do not redesign)

Labels are pre-printed in bulk as **anonymous IDs** with no meaning. A code acquires
meaning the first time it is scanned. This means I can print 600 stickers today and
enroll them over weeks.

### ID scheme

- 4 characters, uppercase, from the alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`
  (Crockford-style: no `0/O`, `1/I/L` confusion when typing by hand).
- **Sequential, not random** — so I can always find the next unused sticker on a sheet.
- Rendered on the label in large monospace next to the QR, so I can type it manually
  when the label is scuffed or the camera won't cooperate.

### QR payload

**Two payload formats, one shared ID pool.** The app must accept both.

**Format A — URL** (boxes and normal items):

```
HTTPS://<USERNAME>.GITHUB.IO/<REPO>/#K7M3
```

- **Uppercase.** This puts the QR in alphanumeric encoding mode instead of byte mode,
  which is ~40% denser. Domains are case-insensitive; the app must `.toUpperCase()`
  the fragment when parsing.
- **ECC level M.** Version 2 (25×25 modules). Minimum 15 mm, target 18–19 mm.
- Benefit: the stock camera app opens the catalog page directly. This matters for
  containers, where someone else may want to see contents without installing anything.

**Format B — bare ID** (not printed for now; support it in the decoder anyway):

```
K7M3
```

- Four alphanumeric characters fit in version 1 (21×21 modules) even at ECC H, so a
  bare-ID code can go as small as 12 mm if a smaller label format is ever needed.
- Cost: no stock-camera deep link. Not printed today — but accepting this format in
  the decoder is three lines of code, and it means a smaller sticker becomes a data
  change later rather than a migration.

**Scan resolution logic:** on decode, if the payload matches the base URL, extract the
fragment; otherwise if it matches `^[ID_ALPHABET]{4}$`, treat it as a bare ID; otherwise
reject with the error tone. Same lookup path after that.

Base URL must be a single constant in one config file, shared by the generator and
the app. If it ever changes, every printed Format A label is dead — treat it as permanent.

**Quiet zone is non-negotiable.** Every QR needs 4 modules of pure white on all sides,
and it is part of the code. On a 13 mm QR that is ~2.5 mm per side. The generator must
enforce this and must never let a QR bleed toward the die-cut edge — a code without its
quiet zone will not scan regardless of module size.

### Label sheet format

**One format. Do not build a multi-format generator.**

| Avery ref | Size | Layout | Payload | QR |
|---|---|---|---|---|
| Zweckform 3666 | 38 × 21.2 mm | 5 × 13 = 65/sheet | URL | ~19 mm |

Media: white matte paper, permanent adhesive, universal (inkjet/laser). Printed on an
office laser. Containers use the same sticker as items — a box label is scanned from
20 cm, not across a room; the across-the-room job is done by a hand-written number in
marker plus coloured tape.

Layout within the label: ~19 mm QR on the left, the 4-char ID in bold monospace on the
right. Nothing else fits and nothing else is needed — the label carries identity, the
app carries meaning.

The generator's sheet geometry must be a config object so a second format (e.g.
Zweckform 3474, 70 × 37 mm, 24/sheet) can be added later as data, not code. Do not add
it now.

**Laser constraint affecting the generator:** partially-used sheets must never be
re-fed through a laser — loose labels can peel off inside the fuser. The "skip first
N labels" offset (§3) is therefore an inkjet/emergency feature only. The default and
documented path is **full sheets only**, with leftover labels kept for later IDs.
The print view must also warn if the browser is scaling: render a 100 mm reference
ruler on the calibration page so I can verify actual size with a real ruler.

Nominal margins for L7651: ~10.7 mm top, ~4.65 mm left, 40.6 mm horizontal pitch,
21.2 mm vertical pitch. **Do not trust these.** Expose every margin/pitch value as a
config object and ship a calibration mode (§3).

Minimum QR size: 18 mm. At ECC-M with the payload above the code is version 2
(25×25 modules), giving ~0.72 mm per module at 18 mm — comfortably scannable.

---

## 3. Deliverable 1: `labels/`

A single static HTML page, opened locally, printed via the browser's print dialog.

**Requirements:**

- Inputs: start ID, count, sheet format (item/container), and a "skip first N labels"
  offset so I can use partially-consumed sheets.
- Renders QR + human-readable ID per label, laid out on exact A4 geometry using
  `mm` CSS units and a `@page { size: A4; margin: 0 }` rule.
- **Calibration mode:** a checkbox that renders 1 mm crosshairs and outlines at every
  label boundary. I print this on plain paper, hold it against a real Avery sheet at
  a window, and adjust the offsets until it lines up. This will save an hour and
  several sheets of wasted labels.
- **Test strip:** a button that renders just the first row, so I can verify scannability
  before printing 10 sheets.
- Maintains a `printed_up_to` value in localStorage so I never reprint an ID. Also
  display it prominently — accidental duplicate IDs would silently corrupt the catalog.
- Use the `qrcode` npm package, vendored locally. The page must work with no network.

**Verify before moving on:** print one item sheet, scan five labels with a phone at
arm's length in dim light. If any fail, increase QR size and reduce text.

---

## 4. Deliverable 2: `app/` — data model

Three IndexedDB object stores.

### `things`

Everything is a thing. Containers are things. There is **no separate box table** —
a suitcase inside a crate inside a room is three rows with `parent_id` links, and
splitting containers from items makes that impossible.

```
id            string   PK, the 4-char code
name          string   optional at enrollment
photo         Blob     ~800px longest edge, JPEG q0.8
thumb         Blob     ~200px longest edge, JPEG q0.7
is_container  boolean
container_kind string  'box' | 'suitcase' | 'crate' | 'bag' | 'shelf' | null
parent_id     string   nullable, FK -> things.id
tags          string[]
room          string   nullable
notes         string   nullable
status        string   'unpacked' | 'packed' | 'gone'
created_at    number
updated_at    number
```

Indexes on `parent_id`, `status`, `is_container`, and a normalized lowercase name
field for search.

### `events` — append-only

```
id         auto
thing_id   string
type       string   'enrolled' | 'packed' | 'unpacked' | 'renamed' | 'moved' | 'deleted'
parent_id  string   nullable — the container involved
payload    object   nullable
ts         number
```

This is the most important design decision in the project. It gives me free undo, a
real audit trail ("when did this leave the closet?"), and — if sync is ever added —
an event log merges trivially where mutable rows do not. **Never mutate `things`
without writing a matching event.**

### `session` — single row

```
mode           'LOOKUP' | 'ENROLL' | 'PACKING'
target_id      string | null    // the container being filled
last_scan_id   string | null
last_scan_ts   number
```

Persist across reloads. If I drop my phone mid-pack, reopening the app must put me
back in PACKING with the same target.

---

## 5. State machine

### LOOKUP (default)

Scan → show the thing.
- Not a container: photo, name, tags, current location breadcrumb
  (`Crate 0042 → Kitchen`), plus actions.
- Container: same, plus its contents as a thumbnail grid, plus a prominent
  **"Pack into this"** button that transitions to PACKING with this as target.
- Unknown ID → transition to ENROLL automatically.

### ENROLL

Entered automatically on an unknown code. Must be the fastest screen in the app.

1. Camera viewfinder opens **immediately**, already live. No "tap to start."
2. Big shutter button. One tap captures.
3. After capture: optional name field (autofocused, so the phone keyboard's mic key
   is one tap away), and a **container toggle** with kind chips.
4. Save → write thing + `enrolled` event → return to the **previous mode**.
   If the previous mode was PACKING, the new thing is immediately packed into the
   target and gets its `packed` event too. This chaining is the whole point.

Also provide **quick-capture**: photo only, no name, save, immediately back to the
viewfinder for the next item. Items land in an "unnamed" queue I can clean up later
on a laptop. I will hit stretches where I just want to keep moving, and if the app
forces a name every time I will stop using it.

### PACKING(target)

A persistent banner across the top of every screen:

```
📦 Packing into "Kitchen Box A" · 14 items · [Done]
```

- Every scan sets that thing's `parent_id = target`, `status = 'packed'`, writes a
  `packed` event, and stays in PACKING. No confirmation dialogs.
- Unknown code → ENROLL → back to PACKING, auto-packed.
- Scanning a thing that is already inside a *different* container: silently move it,
  write an `unpacked` + `packed` pair. Do not throw a modal at me.
- Scanning the target container itself: show its contents (a peek), stay in PACKING.
- Scanning a *different* container: prompt once — "Switch to packing into X?" — since
  this is genuinely ambiguous and the only case that deserves a question.

**Voice control is explicitly out of scope.** "Scan the box → tap Pack into this" is
one tap, always works, and has no ambiguity about which box. The Web Speech API is
inconsistent across browsers and misfires in noisy rooms. The state machine above
would support a voice trigger additively if I ever want it.

---

## 6. Scanning

- **Continuous in-app scanner** is the primary path. Camera stays open, decodes in a
  loop, beeps, advances. The stock-camera → notification → URL flow is fine for a
  one-off lookup by someone helping me, but far too slow for enrolling hundreds of items.
  Both paths resolve the same `#ID` fragment.
- `BarcodeDetector` where available (Chrome/Android), `zxing-wasm` or `html5-qrcode`
  as the Safari/iOS fallback. Feature-detect, don't user-agent sniff.
- **Scan cooldown: ignore a repeat read of the same ID within 2000 ms.** Without this
  a continuous decoder fires the same item 30 times.
- **Accept keyboard input as a scan source.** A Bluetooth ring scanner pairs as an HID
  keyboard: it types the code and presses Enter. If a hidden input stays focused and
  handles that, a €30 ring scanner becomes a drop-in upgrade with zero code changes.
  Detect it by input speed (>50 chars/sec = machine, not human).
- **Non-visual feedback is mandatory.** Distinct Web Audio tones — rising = packed,
  falling = unknown/enroll, buzz = error — plus `navigator.vibrate()`. I need to know
  the scan landed without looking at the screen, because my hands are full.

---

## 7. Photos

- `<input type="file" accept="image/*" capture="environment">` as the fallback;
  `getUserMedia` for the in-app viewfinder (preferred — no OS camera app round trip).
- Downscale on a `<canvas>` **before** writing to IndexedDB: ~800px longest edge for
  the record, ~200px for the thumbnail. Full-resolution photos will blow past the
  storage quota somewhere around a few hundred items.
- Store as Blobs, render with `URL.createObjectURL` and **revoke on unmount** —
  a grid view leaking object URLs will crash the tab.
- Call `navigator.storage.persist()` on first run and surface a warning if it's denied.

---

## 8. Other screens

- **Search** — text across name/tags/room/notes, plus filters for unpacked / unnamed /
  container-kind. Fuzzy match is nice but substring is acceptable.
- **Tree view** — browse containers and drill into contents.
- **Undo** — persistent button that reverses the last event. I *will* scan something
  into the wrong box, probably several times.
- **Container manifest** — a printable A4 page listing a container's contents with
  thumbnails, to tape inside the lid. Redundancy for the day the digital layer is
  inconvenient or the phone is dead.
- **Unnamed queue** — the quick-capture cleanup screen, laptop-friendly.

---

## 9. Export & backup

Browser storage is not a place to keep the only copy of anything.

- One-tap export producing `catalog.json`, `catalog.csv`, and a ZIP of photos named
  `<ID>.jpg`. Use the File System Access API where available, download fallback elsewhere.
- Matching import that restores from that bundle.
- **Nag me:** if the last export was more than 3 days ago or more than 50 events ago,
  show a persistent banner. I commit the export into the repo as my backup.

---

## 10. Stack & deployment

- Vanilla JS or Preact. No heavy framework — this must load instantly on a phone.
- `idb` for IndexedDB. `qrcode` for generation. `zxing-wasm` / `html5-qrcode` for decoding.
- **PWA with a service worker**, precaching the full app shell. Installable to home
  screen. Must work fully in airplane mode after first load — test this explicitly.
- GitHub Pages. HTTPS is non-negotiable: `getUserMedia` requires a secure context.
- Repo layout: `/labels`, `/app`, `/config.js` (shared base URL + ID alphabet), `/backups`.
- Consult `/mnt/skills/public/frontend-design/SKILL.md` before building the UI.

**Mobile UI constraints:** thumb-reachable primary actions (bottom half of screen),
minimum 44px touch targets, works one-handed, high contrast — I will be using this in
a badly lit cellar while holding a box.

---

## 11. Non-goals — do not build these

- Multi-user sync, accounts, or a backend. Single user, local only.
- Voice commands (§5).
- Barcode (EAN/UPC) product lookup.
- Value estimation, depreciation, insurance report generation.
- Native apps.

The event log in §4 exists so that sync *could* be added later as an additive change.
That is the only concession to future scope. Do not design for it now.

---

## 12. Build order

Ship each phase working before starting the next.

1. **Labels.** Generator + calibration + test strip. Print and stick real labels.
2. **Skeleton.** IndexedDB schema, event log, `#ID` fragment routing, thing detail view.
3. **Scan + enroll.** Continuous scanner, camera capture, downscale pipeline, LOOKUP/ENROLL.
4. **Packing.** PACKING mode, banner, parent assignment, undo.
5. **Retrieval.** Search, tree view, container manifest print.
6. **Durability.** Service worker, export/import, backup nag, storage persistence.

---

## 13. Acceptance tests

- [ ] Print an item sheet; 5 random labels scan first-try at arm's length in dim light.
- [ ] Enroll 10 unknown items in under 100 seconds total, one-handed.
- [ ] Enter PACKING on a box, scan 5 items, scan the box — all 5 appear in its contents.
- [ ] Scan an item already in Box A while packing Box B — it moves silently, and the
      event log shows both `unpacked` and `packed`.
- [ ] Undo reverses the last pack correctly.
- [ ] Kill the network entirely (airplane mode), reload the app — full enroll + pack
      loop still works.
- [ ] Export, wipe browser storage, import — catalog and all photos restored intact.
- [ ] Typing a 4-char ID by hand into search resolves to the same thing as scanning it.

---

## 14. Open questions for me

Ask before assuming:

- Repo name and GitHub username — needed to fix the QR base URL, which is permanent.
- Room list — fixed vocabulary or free text?
- Should `status = 'gone'` (sold/donated/binned) be reachable from the main flow, or
  buried? I want the catalog to stay honest after the move.
