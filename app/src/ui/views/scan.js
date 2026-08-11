import { h, plural } from '../dom.js';
import { emptyState, icon, displayName, thumbnail } from '../components.js';
import { normalizeId } from '../../../../shared/ids.js';
import { searchThings } from '../../core/search.js';
import { urlPool } from '../../platform/images.js';

/**
 * Home. The camera is the home screen because the scan is the primary verb —
 * anything that puts a menu between opening the app and reading a code costs
 * seconds per item, and there are hundreds of items.
 *
 * In PACKING mode it is also a workbench: scanning is the fast path, but a
 * thing already in the catalog has no barcode to wave at, so it needs a list
 * you can tap.
 */
export function scanView(app) {
  const pool = urlPool();
  const packing = app.session.mode === 'PACKING' && app.session.target_id;

  const status = h('div.scan__status', null, statusText(app));
  const hint = h('p.scan__hint', null,
    packing ? 'Scan a label, or pick from below' : 'Point at a label. Everything happens on the scan.');

  const manual = h('input.scan__input', {
    type: 'text',
    inputmode: 'text',
    maxlength: 4,
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'CODE',
    'aria-label': 'Type a 4-character code',
    onInput: (e) => {
      e.target.value = normalizeId(e.target.value).slice(0, 4);
    },
    onKeydown: (e) => {
      if (e.key !== 'Enter') return;
      const value = e.target.value;
      e.target.value = '';
      app.scan(value, { source: 'manual' });
    },
  });

  const stage = h(
    'div.scan__stage',
    { class: { 'scan__stage--short': Boolean(packing) } },
    app.video,
    h('div.scan__reticle', { 'aria-hidden': 'true' }),
    status,
  );

  // ── the pick-list, PACKING only ───────────────────────────────────────────

  const results = h('div.list.pick__list');
  const summary = h('span.section__count');
  const filter = h('input.search__input.pick__search', {
    type: 'search',
    placeholder: 'Filter by name, tag or code',
    autocomplete: 'off',
    'aria-label': 'Filter things to pack',
    onInput: () => renderPicks(),
  });

  let candidates = [];

  function renderPicks() {
    const found = searchThings(candidates, { q: filter.value });
    summary.textContent = found.length ? plural(found.length, 'thing') : 'nothing left';
    results.replaceChildren(
      ...(found.length
        ? found.slice(0, 50).map((thing) =>
            h('button.row', {
              type: 'button',
              onClick: async () => {
                await app.packExisting(thing.id);
                await load();
              },
            },
              thumbnail(thing, pool, { size: 'sm' }),
              h('div.row__text', null,
                h('div.row__title', null, `${icon(thing)} ${displayName(thing)}`),
                h('div.row__sub', null, thing.parent_id ? `in ${thing.parent_id}` : 'loose'),
              ),
              h('code.row__id', null, thing.id),
              h('span.pick__add', null, '+'),
            ))
        : [h('p.muted', null, filter.value ? 'Nothing matches.' : 'Everything is already packed.')]),
    );
  }

  /**
   * Candidates are everything not already in this box: unpacked things first,
   * and things sitting in another box too — moving between boxes is normal and
   * the log records it honestly. `all()` comes back newest-touched first, which
   * is the order that matters when a pile has just been scanned.
   */
  async function load() {
    if (!packing) return;
    pool.release();
    const all = await app.catalog.all();
    candidates = all.filter(
      (t) => t.id !== app.session.target_id && t.parent_id !== app.session.target_id && t.status !== 'gone',
    );
    renderPicks();
  }

  const pickPanel = packing
    ? h('section.pick', null,
        h('div.section__head', null,
          h('h2', null, `Add to ${app.targetName ?? app.session.target_id}`),
          summary,
        ),
        filter,
        results,
      )
    : null;

  const view = h(
    'section.view.view--scan',
    null,
    stage,
    h(
      'div.scan__foot',
      null,
      hint,
      h(
        'div.scan__manual',
        null,
        manual,
        h('button.btn.btn--primary', {
          type: 'button',
          onClick: () => {
            const value = manual.value;
            manual.value = '';
            app.scan(value, { source: 'manual' });
          },
        }, 'Look up'),
      ),
      packing ? null : lastScanCard(app),
    ),
    pickPanel,
  );

  view.mounted = async () => {
    const started = await app.startCamera();
    if (!started) {
      stage.replaceChildren(
        emptyState(
          'No camera',
          app.cameraError ?? 'Type a code below, or pick from the list — a Bluetooth ring scanner ' +
            'also works, it types the code and presses Enter.',
        ),
      );
      manual.focus();
    }
    await load();
  };

  view.destroy = () => pool.release();
  return view;
}

function statusText(app) {
  if (app.session.mode === 'PACKING') return `Packing → ${app.targetName ?? app.session.target_id}`;
  return 'Lookup';
}

function lastScanCard(app) {
  const thing = app.lastThing;
  if (!thing) return null;
  return h(
    'button.scan__last',
    { type: 'button', onClick: () => app.open(thing.id) },
    h('span.scan__last-icon', null, icon(thing)),
    h('span.scan__last-name', null, displayName(thing)),
    h('code', null, thing.id),
  );
}
