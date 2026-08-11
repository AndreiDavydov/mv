import test from 'node:test';
import assert from 'node:assert/strict';
import { jsQR } from '../vendor/jsqr.js';
import { buildPayload, parseScan } from '../shared/payload.js';
import { measure, toSVG } from '../shared/qr-svg.js';
import { idRange } from '../shared/ids.js';

/**
 * The loop that matters: what the generator draws must be what the scanner
 * reads. This rasterises the generator's own SVG output and decodes it with
 * the same jsQR build the app ships, so a change to either end breaks here
 * rather than on a sheet of 65 stickers.
 */

const PX_PER_MODULE = 6;

/** Turn a generated SVG back into a bitmap by replaying its module runs. */
function rasterize(svg, total) {
  const side = total * PX_PER_MODULE;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [, x, y, width] of svg.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
    for (let my = 0; my < PX_PER_MODULE; my++) {
      for (let mx = 0; mx < Number(width) * PX_PER_MODULE; mx++) {
        const px = Number(x) * PX_PER_MODULE + mx;
        const py = Number(y) * PX_PER_MODULE + my;
        const at = (py * side + px) * 4;
        data[at] = data[at + 1] = data[at + 2] = 0;
      }
    }
  }
  return { data, width: side, height: side };
}

function decode(payload, options = {}) {
  const { total } = measure(payload, options);
  const image = rasterize(toSVG(payload, options), total);
  return jsQR(image.data, image.width, image.height);
}

test('a rendered format A label decodes back to its id', () => {
  const payload = buildPayload('K7M3');
  const decoded = decode(payload);

  assert.ok(decoded, 'jsQR could not read the generated code');
  assert.equal(decoded.data, payload);
  assert.deepEqual(parseScan(decoded.data), { ok: true, id: 'K7M3', format: 'url' });
});

test('a rendered format B label decodes back to its id', () => {
  const decoded = decode('K7M3');
  assert.ok(decoded);
  assert.equal(decoded.data, 'K7M3');
  assert.deepEqual(parseScan(decoded.data), { ok: true, id: 'K7M3', format: 'bare' });
});

test('every error correction level renders something readable', () => {
  for (const errorCorrectionLevel of ['L', 'M', 'Q', 'H']) {
    const payload = buildPayload('K7M3');
    const decoded = decode(payload, { errorCorrectionLevel });
    assert.ok(decoded, `ECC ${errorCorrectionLevel} did not decode`);
    assert.equal(decoded.data, payload);
  }
});

test('a run of consecutive ids all decode to themselves', () => {
  for (const id of idRange('2222', 12)) {
    const payload = buildPayload(id);
    const decoded = decode(payload);
    assert.ok(decoded, `${id} did not decode`);
    assert.equal(parseScan(decoded.data).id, id);
  }
});
