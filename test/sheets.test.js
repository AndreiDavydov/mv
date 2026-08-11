import test from 'node:test';
import assert from 'node:assert/strict';
import { SHEETS, layoutFor, positionOf, validateSheet } from '../labels/sheets.js';
import { QUIET_MODULES, measure, toSVG } from '../shared/qr-svg.js';
import { buildPayload } from '../shared/payload.js';

const sheet = SHEETS['zweckform-3666'];

test('the sheet geometry fits on A4', () => {
  assert.deepEqual(validateSheet(sheet), []);
});

test('a bad geometry is caught rather than silently overflowing', () => {
  const broken = { ...sheet, columns: 6 };
  assert.match(validateSheet(broken)[0], /columns overflow/);
});

test('label positions walk row-major and wrap onto the next sheet', () => {
  assert.deepEqual(positionOf(sheet, 0), {
    sheet: 0, row: 0, column: 0, x: sheet.margin.left, y: sheet.margin.top,
  });
  assert.equal(positionOf(sheet, 4).column, 4);
  assert.equal(positionOf(sheet, 5).row, 1);
  assert.equal(positionOf(sheet, 5).column, 0);

  const perSheet = sheet.columns * sheet.rows;
  assert.equal(positionOf(sheet, perSheet).sheet, 1);
  assert.deepEqual(positionOf(sheet, perSheet).x, sheet.margin.left);
});

test('the whole grid stays inside the page', () => {
  const perSheet = sheet.columns * sheet.rows;
  for (let i = 0; i < perSheet; i++) {
    const p = positionOf(sheet, i);
    assert.ok(p.x >= 0 && p.x + sheet.label.width <= sheet.page.width, `label ${i} off the page`);
    assert.ok(p.y >= 0 && p.y + sheet.label.height <= sheet.page.height, `label ${i} off the page`);
  }
});

test('the quiet zone is inside the label, never clipped by the die-cut edge', () => {
  const measured = measure(buildPayload('K7M3'));
  const layout = layoutFor(sheet, measured);

  const quietMm = layout.moduleMm * QUIET_MODULES;
  assert.equal(measured.total, measured.modules + QUIET_MODULES * 2);
  assert.ok(
    layout.symbolMm + quietMm * 2 <= sheet.label.height - sheet.padding * 2 + 1e-9,
    'symbol plus quiet zone must fit the label height',
  );
  // Labels touch vertically on this format, so the label height — not a chosen
  // "QR size" — is what governs.
  assert.equal(sheet.pitch.y, sheet.label.height);
});

test('the QR and the ID column both fit the label width', () => {
  const layout = layoutFor(sheet, measure(buildPayload('K7M3')));
  const used = layout.blockMm + layout.textWidthMm + sheet.gutter + sheet.padding * 2;
  assert.ok(Math.abs(used - sheet.label.width) < 1e-9);
  assert.ok(layout.textWidthMm > 10, 'four bold monospace characters need room');
});

test('a longer payload costs a higher version and smaller modules', () => {
  const short = layoutFor(sheet, measure('K7M3'));
  const long = layoutFor(sheet, measure(buildPayload('K7M3')));
  assert.ok(long.version > short.version);
  assert.ok(long.moduleMm < short.moduleMm);
  assert.ok(short.moduleMm > 0.6, 'the bare-ID fallback exists precisely because it is roomier');
});

test('quality grading matches the stated thresholds', () => {
  assert.equal(layoutFor(sheet, { modules: 21, total: 29, version: 1 }).quality, 'good');
  assert.equal(layoutFor(sheet, { modules: 33, total: 41, version: 4 }).quality, 'tight');
  assert.equal(layoutFor(sheet, { modules: 57, total: 65, version: 10 }).quality, 'unscannable');
});

test('the rendered SVG is a self-contained square including the quiet zone', () => {
  const measured = measure(buildPayload('K7M3'));
  const svg = toSVG(buildPayload('K7M3'), { sizeMm: 20.4 });

  assert.match(svg, new RegExp(`viewBox="0 0 ${measured.total} ${measured.total}"`));
  assert.match(svg, /width="20.4mm" height="20.4mm"/);
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/>/, 'quiet zone must be painted white');
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.ok(!svg.includes('http://www.w3.org/1999/xlink'), 'no external references — must print offline');
});

test('the SVG has no dark module inside the quiet zone', () => {
  const svg = toSVG(buildPayload('K7M3'));
  const runs = [...svg.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => m.slice(1).map(Number));
  const { total } = measure(buildPayload('K7M3'));
  assert.ok(runs.length > 0);
  for (const [x, y, width] of runs) {
    assert.ok(x >= QUIET_MODULES, `run starts at ${x}, inside the quiet zone`);
    assert.ok(y >= QUIET_MODULES && y < total - QUIET_MODULES, `row ${y} is inside the quiet zone`);
    assert.ok(x + width <= total - QUIET_MODULES, `run ends at ${x + width}, inside the quiet zone`);
  }
});
