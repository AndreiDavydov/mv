import { h } from '../dom.js';
import { emptyState, icon, displayName } from '../components.js';
import { normalizeId } from '../../../../shared/ids.js';

/**
 * Home. The camera is the home screen because the scan is the primary verb —
 * anything that puts a menu between opening the app and reading a code costs
 * seconds per item, and there are hundreds of items.
 */
export function scanView(app) {
  const status = h('div.scan__status', null, statusText(app));
  const hint = h('p.scan__hint', null, 'Point at a label. Everything happens on the scan.');

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
    null,
    app.video,
    h('div.scan__reticle', { 'aria-hidden': 'true' }),
    status,
  );

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
      lastScanCard(app),
    ),
  );

  view.mounted = async () => {
    const started = await app.startCamera();
    if (!started) {
      stage.replaceChildren(
        emptyState(
          'No camera',
          app.cameraError ?? 'Type a code below, or use a Bluetooth ring scanner — it types the ' +
            'code and presses Enter, which lands in the same place.',
        ),
      );
      manual.focus();
    }
  };

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
