/**
 * Build the two physical proofs used to check the labels before printing a box
 * of stickers, and to run a scan test without a printer:
 *
 *   proofs/sheet-<start>.pdf     full-scale A4, exact Zweckform 3666 geometry
 *   proofs/label-on-box.png      one label at ~4× on cardboard, scannable off a screen
 *
 *   npm run proofs               (needs `npm run serve` on :8087, or pass --port)
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL } from '../config.js';
import { idRange } from '../shared/ids.js';
import { buildPayload } from '../shared/payload.js';
import { measure, toSVG } from '../shared/qr-svg.js';
import { SHEETS, layoutFor } from '../labels/sheets.js';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'proofs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const port = arg('port', '8087');
const start = arg('start', '2222');
const crop = arg('crop', 'K7M3');
const sheet = SHEETS['zweckform-3666'];

/**
 * `--base=` overrides the permanent BASE_URL for the single-label proof only.
 * The point is testing the phone-camera path before the real site exists:
 * point it at the dev server's LAN address and a stock camera app opens the
 * catalog on the phone. Never print a sheet with an overridden base.
 */
const base = arg('base', null);
const skipSheet = process.argv.includes('--no-sheet');
const dx = arg('dx', '0');
const dy = arg('dy', '0');

/**
 * `--sweep` prints one calibration grid per candidate offset, each stamped with
 * the nudge that produced it. Hold the stack against the label sheet, find the
 * page that lines up, and the answer is written on it — one print run instead
 * of a round trip per guess.
 */
if (process.argv.includes('--sweep')) {
  await mkdir(out, { recursive: true });
  const steps = (arg('steps', '0,-0.5,-1,-1.5,-2,-2.5,-3') ).split(',');
  const pages = [];
  for (const step of steps) {
    const file = join(out, `.sweep-${step}.pdf`);
    await run(CHROME, [
      '--headless', '--disable-gpu', '--no-pdf-header-footer',
      '--virtual-time-budget=8000',
      `--print-to-pdf=${file}`,
      `http://localhost:${port}/labels/?calibrate=1&count=0&dx=${dx}&dy=${step}`,
    ]);
    pages.push(file);
  }
  const sweep = join(out, 'calibration-sweep.pdf');
  await run('pdfunite', [...pages, sweep]);
  for (const file of pages) await rm(file);
  console.log(`proofs/calibration-sweep.pdf  ${steps.length} pages, nudged ${steps.join(', ')} mm down`);
  console.log('                              PLAIN PAPER. Find the page that lines up; it says which.');
  process.exit(0);
}

/**
 * The calibration sheet goes on plain paper and gets held against a real label
 * sheet at a window. It is the only way to find out whether this printer agrees
 * with the die-cut before a sheet of stickers is spent finding out.
 */
const calibration = join(out, 'calibration.pdf');
if (!skipSheet) {
  await run(CHROME, [
    '--headless', '--disable-gpu', '--no-pdf-header-footer',
    '--virtual-time-budget=8000',
    `--print-to-pdf=${calibration}`,
    `http://localhost:${port}/labels/?calibrate=1&count=0&dx=${dx}&dy=${dy}`,
  ]).catch((e) => {
    throw new Error(`Chrome failed — is \`npm run serve ${port}\` running?\n${e.stderr ?? e}`);
  });
  console.log('proofs/calibration.pdf       PLAIN PAPER — hold it against a label sheet at a window');
}

await mkdir(out, { recursive: true });

// ── 1. full-scale A4 sheet ──────────────────────────────────────────────────

const pdf = join(out, `sheet-${start}.pdf`);
if (!skipSheet) await run(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-pdf-header-footer',
  '--virtual-time-budget=8000',
  `--print-to-pdf=${pdf}`,
  `http://localhost:${port}/labels/?start=${start}&count=${sheet.columns * sheet.rows}&dx=${dx}&dy=${dy}`,
]).catch((e) => {
  throw new Error(`Chrome failed — is \`npm run serve ${port}\` running?\n${e.stderr ?? e}`);
});
if (!skipSheet) {
  console.log(`proofs/sheet-${start}.pdf        A4, 65 labels, ${start} onward — print at 100%, no scaling`);
}

// ── 2. one label, as if stuck on a box ──────────────────────────────────────

const payload = buildPayload(crop, base ?? BASE_URL);
const layout = layoutFor(sheet, measure(payload));
const cropName =
  arg('out', null) ?? (base ? 'label-on-box-lan' : 'label-on-box');
const SCALE = 14; // px per mm — about 4× life size on a typical screen

const html = `<!doctype html><meta charset="utf-8"><title>${crop}</title>
<style>
  html, body { margin: 0; }
  body {
    width: ${sheet.label.width * SCALE + 320}px;
    height: ${sheet.label.height * SCALE + 320}px;
    display: grid;
    place-items: center;
    background:
      repeating-linear-gradient(90deg, rgb(0 0 0 / 3%) 0 2px, transparent 2px 9px),
      linear-gradient(150deg, #d8b98c, #c9a877 45%, #bb9a68);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .sticker {
    width: ${sheet.label.width * SCALE}px;
    height: ${sheet.label.height * SCALE}px;
    padding: ${sheet.padding * SCALE}px;
    gap: ${sheet.gutter * SCALE}px;
    display: flex;
    align-items: center;
    background: #fff;
    transform: rotate(-1.4deg);
    box-shadow: 0 1px 0 rgb(0 0 0 / 25%), 0 10px 24px rgb(0 0 0 / 28%);
  }
  .sticker svg { display: block; flex: none; }
  .code {
    flex: 1;
    text-align: center;
    font-size: ${sheet.idFontMm * SCALE}px;
    font-weight: 700;
    letter-spacing: 0.05em;
    line-height: 1;
    color: #000;
  }
</style>
<div class="sticker">
  ${toSVG(payload, { sizeMm: layout.blockMm }).replace(/(width|height)="[\d.]+mm"/g, (m, a) => `${a}="${layout.blockMm * SCALE}"`)}
  <div class="code">${crop}</div>
</div>`;

const tmp = join(out, `.${cropName}.html`);
await writeFile(tmp, html);
await run(CHROME, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  '--virtual-time-budget=4000',
  `--screenshot=${join(out, `${cropName}.png`)}`,
  `--window-size=${Math.round(sheet.label.width * SCALE + 320)},${Math.round(sheet.label.height * SCALE + 320)}`,
  `file://${tmp}`,
]);
await rm(tmp);

console.log(
  `proofs/${cropName}.png${base ? '      ' : '          '}one ${crop} label at ${SCALE}px/mm\n` +
    `                                 payload: ${payload}\n` +
    `                                 QR v${layout.version}, ${layout.moduleMm.toFixed(3)} mm modules when printed`,
);

if (base) {
  console.log(
    `\n  Test label only — it points at ${base}, not the permanent BASE_URL.\n` +
      '  Scan it with a phone camera on the same network and the catalog opens\n' +
      '  on the phone at that ID. Do not print a sheet from an overridden base.',
  );
} else {
  console.log(`\nbase url: ${BASE_URL}`);
  if (!skipSheet) {
    console.log(`ids on the sheet: ${idRange(start, 3).join(' ')} … ${idRange(start, 65).at(-1)}`);
  }
}
