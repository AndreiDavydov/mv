/**
 * Sheet geometry as data. One format is supported today; a second one is a new
 * entry here, not new code.
 *
 * Every value is millimetres and every value is nominal — printers and die-cut
 * tolerances vary. Run calibration mode before committing a box of labels.
 */
export const SHEETS = {
  'zweckform-3666': {
    id: 'zweckform-3666',
    name: 'Zweckform 3666 · Avery L7651',
    note: '38.1 × 21.2 mm · 5 × 13 = 65 per sheet',
    page: { width: 210, height: 297 },
    label: { width: 38.1, height: 21.2 },
    margin: { top: 10.7, left: 4.65 },
    pitch: { x: 40.6, y: 21.2 },
    columns: 5,
    rows: 13,
    /** White kept clear of the die-cut edge, on every side of every label. */
    padding: 0.4,
    /** Gap between the QR block and the human-readable ID. */
    gutter: 1.2,
    idFontMm: 5.4,
  },
};

export const DEFAULT_SHEET = 'zweckform-3666';

/** Below this, a phone camera starts failing at arm's length in poor light. */
export const MODULE_MM_COMFORTABLE = 0.5;
export const MODULE_MM_FLOOR = 0.4;

/**
 * Work out how big the QR can actually be on this sheet.
 *
 * The quiet zone is part of the code and these labels touch each other
 * vertically (pitch.y === label.height), so the neighbouring label's ink is
 * the hard limit: the symbol *plus* its four-module border has to fit inside
 * the label height. That makes label height, not a chosen "QR size", the
 * governing dimension.
 *
 * @param {typeof SHEETS[string]} sheet
 * @param {{modules: number, total: number, version: number}} measured  from qr-svg.measure()
 */
export function layoutFor(sheet, measured) {
  const blockMm = sheet.label.height - sheet.padding * 2;
  const moduleMm = blockMm / measured.total;
  const symbolMm = moduleMm * measured.modules;
  const textWidthMm = sheet.label.width - sheet.padding * 2 - blockMm - sheet.gutter;

  return {
    version: measured.version,
    modules: measured.modules,
    blockMm,
    symbolMm,
    moduleMm,
    textWidthMm,
    perSheet: sheet.columns * sheet.rows,
    quality:
      moduleMm >= MODULE_MM_COMFORTABLE
        ? 'good'
        : moduleMm >= MODULE_MM_FLOOR
          ? 'tight'
          : 'unscannable',
  };
}

/** Top-left corner of label `index` (0-based, row-major) in page millimetres. */
export function positionOf(sheet, index) {
  const perSheet = sheet.columns * sheet.rows;
  const onSheet = index % perSheet;
  return {
    sheet: Math.floor(index / perSheet),
    row: Math.floor(onSheet / sheet.columns),
    column: onSheet % sheet.columns,
    x: sheet.margin.left + (onSheet % sheet.columns) * sheet.pitch.x,
    y: sheet.margin.top + Math.floor(onSheet / sheet.columns) * sheet.pitch.y,
  };
}

/** Does the nominal geometry actually fit on the page? Catches typo'd configs. */
export function validateSheet(sheet) {
  const problems = [];
  const right = sheet.margin.left + (sheet.columns - 1) * sheet.pitch.x + sheet.label.width;
  const bottom = sheet.margin.top + (sheet.rows - 1) * sheet.pitch.y + sheet.label.height;
  if (right > sheet.page.width) problems.push(`columns overflow the page by ${fmt(right - sheet.page.width)} mm`);
  if (bottom > sheet.page.height) problems.push(`rows overflow the page by ${fmt(bottom - sheet.page.height)} mm`);
  if (sheet.pitch.x < sheet.label.width) problems.push('horizontal pitch is narrower than the label');
  if (sheet.pitch.y < sheet.label.height) problems.push('vertical pitch is shorter than the label');
  return problems;
}

const fmt = (n) => Math.round(n * 100) / 100;
