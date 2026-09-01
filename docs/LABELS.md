# Labels

Everything about getting codes onto paper and onto boxes.

---

## The paper

**Avery QuickPEEL / Zweckform 3666 — 38 × 21.2 mm, 5 × 13 = 65 per sheet.**
White matte, permanent adhesive, universal (inkjet *and* laser — the pack works
in either, and this build was printed on an office laser).

Containers use the same sticker as items. A box label is read from 20 cm, not
across a room; the across-the-room job is done by a marker pen and coloured tape.

**Print at 100%, no scaling, no "fit to page".** The geometry is exact and any
scaling breaks every column.

**Never re-feed a partly-used sheet through a laser.** Loose labels can peel off
inside the fuser. Print full sheets and keep the leftovers for later codes.

## The geometry was measured, not looked up

The pack's grid is **not** Avery L7651's, even though it is sold as that size.
L7651 assumes 2.5 mm alleys between the columns on a 40.6 mm pitch. This sheet
has no alleys at all — the labels butt together at 38.0 mm, with 10 mm side
margins. Using the published figures put every column after the first in the
wrong place, and it got worse across the page.

| | measured |
|---|---|
| label | 38.0 × 21.2 mm |
| pitch | 38.0 × 21.2 mm — no gaps, in either direction |
| margin | 10.7 top, 10.0 left |

Confirmed three ways on a 600 dpi scan of a sheet with its four corner labels
peeled off: the peel-tab arrows repeat every 38.07 mm, the tab text blocks every
76.06 (two columns), and the exposed top-right cell ends at 199.90 mm against
200.00 predicted. The vertical figures were right all along.

The numbers live in `labels/sheets.js` as data, and four tests in
`test/sheets.test.js` hold them to the scan — including a symmetry check, which
is how a mistyped measurement announces itself.

## QR size: 16.0 mm, not the 18–19 mm the brief asked for

Three requirements in the brief cannot hold together: a ~19 mm QR, a
non-negotiable 4-module quiet zone, and this sheet format.

The labels touch vertically (pitch 21.2 = label height 21.2), so the
neighbouring label's ink is the hard boundary: the symbol **plus** its quiet
zone must fit inside 21.2 mm. For a 25×25 symbol that is `S × 33/25 ≤ 21.2`, so
`S ≤ 16.1 mm`. A 19 mm symbol would need a 25 mm label.

The payload is also bigger than the brief assumed.
`HTTPS://ANDREIDAVYDOV.GITHUB.IO/mv/app/#K7M3` is QR **version 3** (29×29), not
version 2 — version 2 at ECC-M tops out at 38 alphanumeric characters.

So the generator measures rather than assumes: it reads the version off the
encoder, derives the module size from the label height, and displays it.

| payload | version | symbol | module |
|---|---|---|---|
| Format A, URL, ECC M | 3 | 16.0 mm | **0.551 mm** |
| Format B, bare ID, ECC M | 1 | 14.8 mm | **0.703 mm** |

0.55 mm modules are workable for a phone at 20–40 cm but below the 0.72 mm the
brief expected, and **this has never been tested off real paper.** If the
printed labels fail in dim light, three fixes are already built in, in order of
preference:

1. switch the payload to **Format B** (bare ID) — 0.70 mm modules, but no
   stock-camera deep link;
2. drop to **ECC L**;
3. **shorten `BASE_URL`** — under 33 characters brings Format A back to
   version 2.

## The quiet zone

Four modules of pure white on all four sides, and it is part of the code — a QR
without it does not scan regardless of module size. Because these labels butt
against each other, the neighbour's ink is what would eat it. Two tests assert
that no dark module ever lands inside the border, and one asserts the symbol
plus both quiet zones fits the label height.

## Printing a sheet

```bash
npm run serve                          # in one terminal
npm run proofs -- --sheets=4           # four sheets in one PDF, from the next free code
```

The PDF lands in `proofs/`. Print it, check it came out right, and only then
record it:

```bash
npm run proofs -- --start=22A6 --sheets=4 --mark
```

Two other outputs come from the same command:

- `proofs/calibration.pdf` — **plain paper.** Hold it against a real label sheet
  at a window. This is the only way to find out whether your printer agrees with
  the die-cut before spending a sheet of stickers finding out.
- `npm run proofs -- --sweep` — one calibration grid per candidate offset, each
  stamped with the nudge that produced it. Find the page that lines up and the
  answer is written on it. Nudge with `--dx` / `--dy` in millimetres.

## Which codes have been printed

`proofs/printed.json` is the ledger, committed alongside the code.

The labels page keeps the same counter in the browser, but sheets generated from
the command line never touch the browser — so without this, nothing stopped two
boxes answering to the same code. Generating refuses a code already recorded;
`--mark` records a range only once it has actually printed, because a sheet that
jammed has not consumed anything.

Current state: **4 sheets, 260 labels, `2222` … `22A5`. Next free: `22A6`.**

## The codes themselves

Four characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` — Crockford-style, with
`0/O` and `1/I/L` left out so a scuffed label cannot be mistyped into a
different thing. Sequential, not random, so the next unused sticker on a sheet
is always the obvious one. 32⁴ = 1,048,576 codes.

The code is printed in large bold monospace beside the QR, so it can be typed by
hand when the label is scuffed or the camera will not cooperate.

## Testing a label without a printer

```bash
npm run proofs -- --no-sheet --base=http://<LAN-IP>:8087/app
```

Produces `proofs/label-on-box-lan.png`, a single label at about 4× life size on
cardboard, pointing at your dev server. Scan it off the screen with a phone on
the same network.

**Never print a sheet from an overridden base.** The override exists for screen
tests only, and `BASE_URL` is permanent — changing it kills every label already
stuck to a box.
