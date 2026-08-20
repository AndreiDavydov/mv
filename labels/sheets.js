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
    name: 'Avery QuickPEEL 38 × 21.2',
    note: '38 × 21.2 mm · 5 × 13 = 65 per sheet · no gaps between labels',
    page: { width: 210, height: 297 },
    /*
     * Measured from a real sheet, not taken from a datasheet.
     *
     * The nominal Avery L7651 figures — 38.1 wide on a 40.6 pitch, 4.65 left
     * margin — describe a sheet with 2.5 mm alleys between the columns. This
     * one has none: the labels butt together at 38.0, which puts every column
     * after the first in the wrong place and gets worse across the page.
     *
     * Confirmed three ways on a 600 dpi scan of the sheet with its four corner
     * labels peeled off: the peel-tab arrows repeat every 38.07 mm, the tab
     * text blocks every 76.06 (two columns), and the exposed top-right cell
     * ends at 199.90 against 200.00 predicted here. The vertical figures were
     * right already — the exposed bottom row measured 265.09 … 286.26 against
     * 265.10 … 286.30 predicted.
     */
    label: { width: 38.0, height: 21.2 },
    margin: { top: 10.7, left: 10.0 },
    pitch: { x: 38.0, y: 21.2 },
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
