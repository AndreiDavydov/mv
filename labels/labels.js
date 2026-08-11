import { BASE_URL, BASE_URL_CONFIRMED } from '../config.js';
import { ID_SPACE, idFromIndex, idRange, indexFromId, isValidId, normalizeId } from '../shared/ids.js';
import { buildPayload } from '../shared/payload.js';
import { measure, toSVG } from '../shared/qr-svg.js';
import { DEFAULT_SHEET, SHEETS, layoutFor, positionOf, validateSheet } from './sheets.js';

const PRINTED_KEY = 'labels.printed_up_to'; // count of IDs consumed, from index 0

const $ = (id) => document.getElementById(id);
const el = {
  sheet: $('sheet'),
  payloadFormat: $('payload-format'),
  ecc: $('ecc'),
  start: $('start'),
  count: $('count'),
  offset: $('offset'),
  calibrate: $('calibrate'),
  testStrip: $('test-strip'),
  fit: $('fit'),
  pages: $('pages'),
  readout: $('readout'),
  qualityNotice: $('quality-notice'),
  offsetNotice: $('offset-notice'),
  configNotice: $('config-notice'),
  previewSummary: $('preview-summary'),
  printedUpTo: $('printed-up-to'),
  printedCount: $('printed-count'),
  countPresets: $('count-presets'),
};

// ── printed-up-to bookkeeping ───────────────────────────────────────────────
// Duplicate IDs would silently corrupt the catalog: two boxes answering to the
// same code, with no way to tell which row is which. This counter is the only
// thing preventing that, so it is shown at all times and is hard to nudge.

const printedCount = () => Math.max(0, Number(localStorage.getItem(PRINTED_KEY)) || 0);
const setPrintedCount = (n) => {
  localStorage.setItem(PRINTED_KEY, String(Math.max(0, Math.min(ID_SPACE, Math.floor(n)))));
  renderCounter();
};
const nextUnusedId = () => idFromIndex(Math.min(printedCount(), ID_SPACE - 1));

function renderCounter() {
  const n = printedCount();
  el.printedUpTo.textContent = n === 0 ? 'none yet' : idFromIndex(n - 1);
  el.printedCount.textContent = n === 0 ? '' : `· ${n.toLocaleString()} printed · next ${nextUnusedId()}`;
}

// ── state ───────────────────────────────────────────────────────────────────

function readState() {
  const sheet = SHEETS[el.sheet.value] ?? SHEETS[DEFAULT_SHEET];
  const start = normalizeId(el.start.value);
  const perSheet = sheet.columns * sheet.rows;
  const offset = clamp(Number(el.offset.value) || 0, 0, perSheet - 1);
  const count = clamp(Number(el.count.value) || 0, 0, 2600);
  return {
    sheet,
    start,
    startValid: isValidId(start),
    count: el.testStrip.checked ? Math.min(count, sheet.columns) : count,
    offset: el.testStrip.checked ? 0 : offset,
    calibrate: el.calibrate.checked,
    testStrip: el.testStrip.checked,
    ecc: el.ecc.value,
    payloadFormat: el.payloadFormat.value,
  };
}

const payloadFor = (id, state) =>
  state.payloadFormat === 'bare' ? id : buildPayload(id, BASE_URL);

// ── rendering ───────────────────────────────────────────────────────────────

function render() {
  const state = readState();
  el.start.setAttribute('aria-invalid', String(!state.startValid));

  const sample = payloadFor(state.startValid ? state.start : '2222', state);
  const measured = measure(sample, { errorCorrectionLevel: state.ecc });
  const layout = layoutFor(state.sheet, measured);

  renderReadout(state, layout, sample);
  renderNotices(state, layout);
  renderPages(state, layout);
}

function renderReadout(state, layout, sample) {
  const rows = [
    ['Sheet', `${state.sheet.name} · ${layout.perSheet}/sheet`],
    ['Payload', `${sample.length} chars · QR version ${layout.version} · ${layout.modules}×${layout.modules}`],
    ['QR symbol', `${mm(layout.symbolMm)} mm + 4-module quiet zone`],
    ['Module size', `${layout.moduleMm.toFixed(3)} mm`],
    ['ID column', `${mm(layout.textWidthMm)} mm wide`],
  ];
  if (state.startValid && state.count > 0) {
    const last = idFromIndex(indexFromId(state.start) + state.count - 1);
    rows.push(['Range', `${state.start} → ${last}`]);
    rows.push(['Sheets', String(Math.ceil((state.count + state.offset) / layout.perSheet))]);
  }
  el.readout.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('');
}

/**
 * A hostname is case-insensitive; a path is not. `github.io/MV/` 404s when the
 * repository is `mv`. Uppercasing the whole URL for QR density silently breaks
 * every label, so the path is checked before anything can be printed.
 */
function pathCaseProblem(baseUrl) {
  try {
    const path = new URL(baseUrl).pathname;
    if (!/[A-Z]/.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}

function renderNotices(state, layout) {
  const badPath = pathCaseProblem(BASE_URL);

  el.configNotice.innerHTML = badPath
    ? notice(
        'bad',
        'The path in BASE_URL is uppercase',
        `Hostnames are case-insensitive but paths are not — GitHub Pages will 404 on ` +
          `<code>${escapeHtml(badPath)}</code> unless the repository is named with exactly ` +
          'that casing. Fix the path in <code>/config.js</code> to match the repository name. ' +
          'It costs nothing: the QR version is the same either way.',
      )
    : BASE_URL_CONFIRMED
    ? ''
    : notice(
        'bad',
        'Base URL not confirmed',
        `Every Format A label will point at <code>${escapeHtml(BASE_URL)}</code> forever. ` +
          'Check it, then set <code>BASE_URL_CONFIRMED = true</code> in <code>/config.js</code>. ' +
          'Until then only the test strip and calibration sheet will print.',
      );

  el.offsetNotice.innerHTML =
    state.offset > 0
      ? notice(
          'warn',
          'Partly-used sheet',
          'Never re-feed a partly-used sheet through a laser printer — a loose label can peel ' +
            'off inside the fuser. Inkjet or emergencies only; otherwise print full sheets and ' +
            'keep the leftovers for later IDs.',
        )
      : '';

  const quality = {
    good: () =>
      notice(
        'good',
        `Modules are ${layout.moduleMm.toFixed(2)} mm`,
        'Comfortably above the 0.5 mm working floor for a phone camera at arm’s length.',
      ),
    tight: () =>
      notice(
        'warn',
        `Modules are only ${layout.moduleMm.toFixed(2)} mm`,
        'Below 0.5 mm. Print the test strip and scan it in dim light before committing a sheet. ' +
          'Switching to ECC L, or to the bare-ID payload, makes the modules bigger.',
      ),
    unscannable: () =>
      notice(
        'bad',
        `Modules are ${layout.moduleMm.toFixed(2)} mm — too small`,
        'Shorten the base URL, drop to ECC L, or switch to the bare-ID payload.',
      ),
  }[layout.quality]();

  const geometry = validateSheet(state.sheet);
  el.qualityNotice.innerHTML =
    quality + (geometry.length ? notice('bad', 'Sheet geometry does not fit A4', geometry.join('; ')) : '');
}

function renderPages(state, layout) {
  el.pages.innerHTML = '';
  if (!state.startValid) {
    el.pages.innerHTML = `<div class="empty">Enter a valid 4-character start ID.</div>`;
    el.previewSummary.textContent = '';
    return;
  }
  if (state.count === 0) {
    el.pages.innerHTML = `<div class="empty">Set a count above zero.</div>`;
    el.previewSummary.textContent = '';
    return;
  }

  const { sheet } = state;
  const ids = idRange(state.start, state.count);
  const slots = ids.map((id, i) => ({ id, position: positionOf(sheet, i + state.offset) }));
  const pageCount = Math.max(...slots.map((s) => s.position.sheet)) + 1;

  for (let p = 0; p < pageCount; p++) {
    const page = document.createElement('div');
    page.className = `page${state.calibrate ? ' calibrate' : ''}`;
    page.innerHTML =
      slots
        .filter((s) => s.position.sheet === p)
        .map((s) => labelHtml(s, sheet, layout, state))
        .join('') +
      (state.calibrate ? calibrationOverlay(sheet) : '');
    el.pages.append(page);
  }

  el.previewSummary.textContent =
    `${state.count} label${state.count === 1 ? '' : 's'} · ${pageCount} page${pageCount === 1 ? '' : 's'}` +
    (state.testStrip ? ' · test strip' : '') +
    (state.calibrate ? ' · calibration' : '');
  applyFit();
}

function labelHtml({ id, position }, sheet, layout, state) {
  const svg = toSVG(payloadFor(id, state), {
    errorCorrectionLevel: state.ecc,
    sizeMm: layout.blockMm,
    className: 'qr',
  });
  return (
    `<div class="label" style="left:${position.x}mm;top:${position.y}mm;` +
    `width:${sheet.label.width}mm;height:${sheet.label.height}mm;padding:${sheet.padding}mm;` +
    `gap:${sheet.gutter}mm">` +
    svg +
    `<div class="code" style="font-size:${sheet.idFontMm}mm">${id}</div>` +
    `</div>`
  );
}

/**
 * Print this on plain paper and hold it against a real Avery sheet at a window.
 * Every die-cut position is outlined — not just the ones a label landed on —
 * because the whole point is checking the grid, and a crosshair at each of the
 * four corners is what you actually line up against the die-cut.
 */
function calibrationOverlay(sheet) {
  const perSheet = sheet.columns * sheet.rows;
  let out = '';
  for (let i = 0; i < perSheet; i++) {
    const { x, y } = positionOf(sheet, i);
    out +=
      `<div class="cal-cell" style="left:${x}mm;top:${y}mm;` +
      `width:${sheet.label.width}mm;height:${sheet.label.height}mm"></div>`;
    for (const [cx, cy] of [
      [x, y],
      [x + sheet.label.width, y],
      [x, y + sheet.label.height],
      [x + sheet.label.width, y + sheet.label.height],
    ]) {
      out += `<div class="crosshair" style="left:${cx}mm;top:${cy}mm"></div>`;
    }
  }

  let ticks = '';
  for (let i = 0; i <= 100; i += 5) {
    ticks += `<i class="${i % 10 === 0 ? 'major' : ''}" style="left:${i}mm"></i>`;
  }
  return (
    out +
    `<div class="ruler">${ticks}</div>` +
    `<div class="ruler-caption">100 mm — measure it. Any other reading means the print dialog is scaling.</div>`
  );
}

/**
 * Scale the preview to the viewport; printing always resets to 1:1.
 * `offsetWidth` is the pre-transform layout width, so this stays correct no
 * matter what scale was applied last time.
 */
function applyFit() {
  const pages = [...el.pages.querySelectorAll('.page')];
  if (!pages.length) return;
  const scale = el.fit.checked ? Math.min(1, el.pages.clientWidth / pages[0].offsetWidth) : 1;
  for (const page of pages) {
    page.style.transform = `scale(${scale})`;
    page.style.marginBottom = `${(scale - 1) * page.offsetHeight}px`;
  }
}

// ── actions ─────────────────────────────────────────────────────────────────

function print() {
  const state = readState();
  const badPath = pathCaseProblem(BASE_URL);
  if (badPath && state.payloadFormat === 'url' && !state.calibrate && !state.testStrip) {
    alert(
      `BASE_URL has an uppercase path: ${badPath}\n\n` +
        'Paths are case-sensitive — every one of these labels would 404.\n' +
        'Fix the path in /config.js to match the repository name exactly.',
    );
    return;
  }
  if (!BASE_URL_CONFIRMED && state.payloadFormat === 'url' && !state.calibrate && !state.testStrip) {
    alert(
      'BASE_URL has not been confirmed.\n\n' +
        'Open /config.js, check the URL, and set BASE_URL_CONFIRMED = true.\n' +
        'Calibration sheets and test strips still print without it.',
    );
    return;
  }
  window.print();
}

function markPrinted() {
  const state = readState();
  if (!state.startValid || state.count < 1) return;
  const end = indexFromId(state.start) + state.count;
  if (end <= printedCount()) {
    alert(`${idFromIndex(end - 1)} is already inside the printed range. Nothing changed.`);
    return;
  }
  if (indexFromId(state.start) > printedCount()) {
    const skipped = indexFromId(state.start) - printedCount();
    if (!confirm(`This leaves a gap of ${skipped} unprinted ID(s) starting at ${nextUnusedId()}.\n\nMark anyway?`)) return;
  }
  setPrintedCount(end);
  el.start.value = nextUnusedId();
  render();
}

function editCounter() {
  const current = printedCount();
  const answer = prompt(
    'Number of IDs already printed, counting from 2222.\n' +
      'Only change this if you know a sheet was wasted or double-printed.',
    String(current),
  );
  if (answer === null) return;
  const n = Number(answer);
  if (!Number.isInteger(n) || n < 0 || n > ID_SPACE) return alert('Not a valid count.');
  setPrintedCount(n);
  el.start.value = nextUnusedId();
  render();
}

// ── wiring ──────────────────────────────────────────────────────────────────

for (const [key, sheet] of Object.entries(SHEETS)) {
  el.sheet.append(new Option(`${sheet.name} — ${sheet.note}`, key, key === DEFAULT_SHEET, key === DEFAULT_SHEET));
}

const perSheet = SHEETS[DEFAULT_SHEET].columns * SHEETS[DEFAULT_SHEET].rows;
for (const sheets of [1, 2, 5, 10]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.textContent = `${sheets} sheet${sheets === 1 ? '' : 's'} (${sheets * perSheet})`;
  button.onclick = () => {
    el.count.value = String(sheets * perSheet);
    el.testStrip.checked = false;
    render();
  };
  el.countPresets.append(button);
}

el.start.value = nextUnusedId();

/**
 * Query parameters mirror the controls, so a calibration sheet or a test strip
 * is a bookmarkable URL rather than three clicks:
 *   ?calibrate=1  ?strip=1  ?start=K7M3  ?count=10  ?offset=3  ?ecc=L  ?payload=bare
 */
(function applyQuery() {
  const q = new URLSearchParams(location.search);
  const bind = (key, control, transform = (v) => v) => {
    if (!q.has(key)) return;
    const value = transform(q.get(key));
    if (control.type === 'checkbox') control.checked = value !== '0' && value !== 'false';
    else control.value = value;
  };
  bind('start', el.start, normalizeId);
  bind('count', el.count);
  bind('offset', el.offset);
  bind('ecc', el.ecc, (v) => v.toUpperCase());
  bind('payload', el.payloadFormat, (v) => v.toLowerCase());
  bind('calibrate', el.calibrate);
  bind('strip', el.testStrip);
})();

el.start.addEventListener('input', () => {
  const caret = el.start.selectionStart;
  el.start.value = normalizeId(el.start.value).slice(0, 4);
  el.start.setSelectionRange(caret, caret);
});

for (const control of [el.sheet, el.payloadFormat, el.ecc, el.start, el.count, el.offset, el.calibrate, el.testStrip]) {
  control.addEventListener('input', render);
  control.addEventListener('change', render);
}
el.fit.addEventListener('change', applyFit);
window.addEventListener('resize', applyFit);
$('print').addEventListener('click', print);
$('mark-printed').addEventListener('click', markPrinted);
$('edit-counter').addEventListener('click', editCounter);

window.addEventListener('afterprint', () => {
  const state = readState();
  if (state.calibrate || state.testStrip || !state.startValid) return;
  const end = indexFromId(state.start) + state.count - 1;
  if (confirm(`Did ${state.start} → ${idFromIndex(end)} print correctly?\n\nOK marks them as used so they are never reprinted.`)) {
    markPrinted();
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

function notice(kind, title, body) {
  return `<div class="notice ${kind}"><b>${title}</b><p>${body}</p></div>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const mm = (n) => (Math.round(n * 100) / 100).toFixed(2);

renderCounter();
render();
