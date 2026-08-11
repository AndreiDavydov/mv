import { h, plural } from '../dom.js';
import { askSheet } from '../components.js';
import { buildBundle, readBundle, restore, save } from '../../platform/files.js';
import { isMuted, setMuted } from '../../platform/feedback.js';
import { BASE_URL, SUPABASE_URL } from '../../../../config.js';

/**
 * The catalog lives on a server now, so this is no longer a nag screen — the
 * data survives a lost phone on its own. It stays for the two things a hosted
 * database does not give you: a copy you can read without it, and a copy you
 * own if the project ever goes away.
 */
export function backupView(app, { eventCount, thingCount, online }) {
  const busy = h('p.muted');

  const importInput = h('input', {
    type: 'file',
    accept: '.zip,.json,application/zip,application/json',
    style: { display: 'none' },
    onChange: (e) => {
      const [file] = e.target.files;
      e.target.value = '';
      if (file) confirmImport(file);
    },
  });

  async function exportNow() {
    busy.textContent = 'Packing the bundle…';
    try {
      const bundle = await buildBundle(app.catalog);
      const result = await save(bundle.blob, bundle.filename);
      if (!result.saved) return void (busy.textContent = 'Export cancelled.');
      busy.textContent =
        `Saved ${bundle.filename} — ${plural(bundle.counts.things, 'thing')}, ` +
        `${plural(bundle.counts.events, 'event')}, ${plural(bundle.counts.photos, 'photo')}.`;
      app.toast('Exported', 'good');
    } catch (error) {
      busy.textContent = '';
      app.toast(`Export failed: ${error.message}`, 'bad');
    }
  }

  function confirmImport(file) {
    askSheet({
      title: 'Replace the shared catalog?',
      // Worth spelling out: this is not a local undo. It wipes what everyone sees.
      detail: `This clears the catalog for everyone — every phone and laptop — and ` +
        `restores ${file.name} in its place. Anyone scanning right now will lose their work. ` +
        'Export first if you are not certain.',
      confirmLabel: 'Replace for everyone',
      onConfirm: async () => {
        busy.textContent = 'Restoring…';
        try {
          const counts = await restore(app.catalog, await readBundle(file));
          busy.textContent =
            `Restored ${plural(counts.things, 'thing')} and ${plural(counts.events, 'event')}.`;
          app.toast('Catalog restored', 'good');
          await app.refresh();
        } catch (error) {
          busy.textContent = '';
          app.toast(`Import failed: ${error.message}`, 'bad');
        }
      },
    });
  }

  return h('section.view.view--list', null,
    h('div.section__head', null, h('h2', null, 'Catalog'),
      h('span.section__count', null, `${plural(thingCount, 'thing')} · ${plural(eventCount, 'event')}`)),

    h('div.card-block', { class: online ? 'card-block--ok' : 'card-block--warn' },
      h('b', null, online ? 'Shared and connected' : 'Not connected'),
      h('p', null, online
        ? 'One catalog, every device. Anything scanned on a phone appears here the moment it lands.'
        : 'This screen is showing whatever loaded last. Scans will not save until the connection returns.'),
      h('button.btn', { type: 'button', onClick: () => app.checkConnection() }, 'Check connection'),
    ),

    h('div.card-block', null,
      h('b', null, 'Download a copy'),
      h('p', null,
        'A ZIP holding catalog.json, catalog.csv and every photo. Readable without this app, ' +
        'and without the database — commit it to the repo and the move is recorded for good.'),
      h('div.enroll__actions', null,
        h('button.btn.btn--big.btn--primary', { type: 'button', onClick: exportNow }, 'Export bundle'),
        h('button.btn.btn--big', { type: 'button', onClick: () => importInput.click() }, 'Import…'),
      ),
      busy,
      importInput,
    ),

    h('div.card-block', null,
      h('b', null, 'Sound'),
      h('label.toggle', null,
        h('input', {
          type: 'checkbox',
          checked: !isMuted(),
          onChange: (e) => {
            setMuted(!e.target.checked);
            localStorage.setItem('app.muted', String(!e.target.checked));
          },
        }),
        h('span', null, 'Scan tones (vibration stays on either way)'),
      ),
    ),

    h('div.card-block', null,
      h('b', null, 'This build'),
      h('p.muted', null, 'Labels point at ', h('code', null, BASE_URL)),
      h('p.muted', null, 'Database ', h('code', null, host(SUPABASE_URL))),
      h('p.muted', null,
        'Anyone with the site link can read and write the catalog — that is what lets a helper ' +
        'open a link and start scanning. Nothing is stored on the scanning device.'),
    ),
  );
}

const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'not configured';
  }
};
