import { create } from '../vendor/qrcode.js';

/**
 * QR codes as SVG rather than canvas: a printed label is a vector job, and a
 * rasterised QR at the printer's resolution either blurs the module edges or
 * needs a canvas ten times the size of the page.
 */

/** The quiet zone is part of the code. Four modules, every side, always. */
export const QUIET_MODULES = 4;

/**
 * Measure what a payload actually costs, instead of assuming a version.
 * @returns {{version: number, modules: number, total: number}} `total` counts
 *   the quiet zone, and is the number the layout has to fit.
 */
export function measure(payload, { errorCorrectionLevel = 'M' } = {}) {
  const qr = create(payload, { errorCorrectionLevel });
  const modules = qr.modules.size;
  return { version: qr.version, modules, total: modules + QUIET_MODULES * 2 };
}

/**
 * Render `payload` as an SVG string whose viewBox is the full symbol *including*
 * the quiet zone, so callers can size it as one opaque block.
 *
 * @param {string} payload
 * @param {{errorCorrectionLevel?: string, sizeMm?: number, className?: string}} [options]
 */
export function toSVG(payload, { errorCorrectionLevel = 'M', sizeMm, className = '' } = {}) {
  const qr = create(payload, { errorCorrectionLevel });
  const { size, data } = qr.modules;
  const total = size + QUIET_MODULES * 2;

  let path = '';
  for (let row = 0; row < size; row++) {
    let run = 0;
    for (let col = 0; col <= size; col++) {
      const dark = col < size && data[row * size + col];
      if (dark) {
        run++;
        continue;
      }
      if (run) {
        path += `M${col - run + QUIET_MODULES} ${row + QUIET_MODULES}h${run}v1h-${run}z`;
        run = 0;
      }
    }
  }

  const dimensions = sizeMm ? ` width="${sizeMm}mm" height="${sizeMm}mm"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"` +
    `${dimensions}${className ? ` class="${className}"` : ''}` +
    ` shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    `</svg>`
  );
}
