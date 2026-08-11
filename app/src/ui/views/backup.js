import { h, plural, timeAgo } from '../dom.js';
import { askSheet } from '../components.js';
import { backupStatus } from '../../core/backup.js';
import { buildBundle, readBundle, restore, save } from '../../platform/files.js';
import { derivePhotos } from '../../platform/images.js';
import { isMuted, setMuted } from '../../platform/feedback.js';
import { BASE_URL } from '../../../../config.js';

/**
 * Browser storage is not a place to keep the only copy of anything. This screen
 * exists so that the answer to "where is my catalog?" is a file in a repo, not
 * a directory inside a browser profile that a settings sweep can erase.
 */
export function backupView(app, { lastExportTs, lastExportEventCount, eventCount, thingCount, persisted, estimate }) {
  const status = backupStatus({ lastExportTs, lastExportEventCount, eventCount, now: Date.now() });
  const busy = h('p.muted');

  const importInput = h('input', {
    type: 'file',
    accept: '.zip,.json,application/zip,application/json',
    style: { display: 'none' },
    onChange: async (e) => {
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
      await app.markExported(eventCount);
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
      title: 'Replace the catalog?',
      detail: `Importing ${file.name} clears everything currently stored and restores the bundle. ` +
        'Export first if you are not sure.',
      confirmLabel: 'Replace',
      onConfirm: async () => {
        busy.textContent = 'Restoring…';
        try {
          const bundle = await readBundle(file);
          const counts = await restore(app.catalog, bundle, { derivePhotos });
          busy.textContent =
            `Restored ${plural(counts.things, 'thing')}, ${plural(counts.events, 'event')}, ` +
            `${plural(counts.photos, 'photo')}.`;
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
    h('div.section__head', null, h('h2', null, 'Backup'),
      h('span.section__count', null, `${plural(thingCount, 'thing')} · ${plural(eventCount, 'event')}`)),

    h('div.card-block', { class: status.due ? 'card-block--warn' : 'card-block--ok' },
      h('b', null, status.due ? 'Export is due' : 'Backup is current'),
      h('p', null, describe(status, lastExportTs)),
      h('div.enroll__actions', null,
        h('button.btn.btn--big.btn--primary', { type: 'button', onClick: exportNow }, 'Export bundle'),
        h('button.btn.btn--big', { type: 'button', onClick: () => importInput.click() }, 'Import…'),
      ),
      busy,
      importInput,
    ),

    h('div.card-block', null,
      h('b', null, 'Storage'),
      h('p', null, persisted
        ? 'Storage is persistent — the browser will not evict this catalog to reclaim space.'
        : 'Storage is NOT persistent. The browser may evict this catalog under storage pressure. ' +
          'Export often, and install the app to your home screen to improve the odds.'),
      estimate
        ? h('p.muted', null,
            `${formatBytes(estimate.usage)} used of ${formatBytes(estimate.quota)} available.`)
        : null,
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
      h('p.muted', null, 'Label base URL: ', h('code', null, BASE_URL)),
      h('p.muted', null, 'Everything is stored on this device only. No account, no server, no sync.'),
    ),
  );
}

function describe(status, lastExportTs) {
  if (status.reason === 'never') return 'Nothing has ever been exported from this device.';
  const since = `Last export ${timeAgo(lastExportTs)}, ${plural(status.events, 'event')} ago.`;
  if (status.reason === 'stale') return `${since} That is more than three days.`;
  if (status.reason === 'events') return `${since} That is more than fifty events.`;
  return since;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 1000 ** exp).toFixed(exp ? 1 : 0)} ${units[exp]}`;
}
