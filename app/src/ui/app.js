import { isConfigured } from '../../../config.js';
import { isValidId, normalizeId } from '../../../shared/ids.js';
import { parseScan } from '../../../shared/payload.js';
import { RemoteCatalog } from '../core/remote.js';
import { cueFor, decideScan, finishEnroll, startPacking, stopPacking } from '../core/machine.js';
import { CameraScanner, KeyboardScanner } from '../platform/scanner.js';
import { play, setMuted, warmUp } from '../platform/feedback.js';
import { h, plural } from './dom.js';
import { askSheet, displayName } from './components.js';
import { scanView } from './views/scan.js';
import { enrollView } from './views/enroll.js';
import { thingView, unknownView } from './views/thing.js';
import { searchView, treeView, unnamedView } from './views/browse.js';
import { manifestView } from './views/manifest.js';
import { backupView } from './views/backup.js';

/**
 * The controller. It owns the catalog, the camera, the session, and the one
 * pipeline every scan flows through — camera, ring scanner, typed code and
 * `#ID` deep link all converge on `scan()`.
 */
export class App {
  catalog;
  session;
  scanner;
  keyboard;
  video;

  lastThing = null;
  lastRoom = null;
  targetName = null;
  cameraError = null;

  #root;
  #banner;
  #viewHost;
  #tabbar;
  #toasts;
  #current = null;
  #pendingEnroll = null;
  #navigating = false;
  #liveTimer = null;
  #online = true;

  constructor(root) {
    this.#root = root;
    this.video = h('video.viewfinder', { playsinline: true, muted: true, autoplay: true });
    this.#banner = h('div#banner');
    this.#viewHost = h('main#view');
    this.#tabbar = h('nav#tabbar');
    this.#toasts = h('div#toasts', { role: 'status', 'aria-live': 'polite' });
    root.append(this.#banner, this.#viewHost, this.#tabbar, this.#toasts);
  }

  async boot() {
    if (!isConfigured()) return this.#mount(setupView());

    this.catalog = RemoteCatalog.open();
    this.session = await this.catalog.session();
    setMuted(localStorage.getItem('app.muted') === 'true');

    // The whole point of the shared catalog: a scan on someone else's phone
    // redraws this screen. Coalesced, because packing a box emits two writes
    // in a row and redrawing twice makes the list flicker.
    this.catalog.onChange(() => {
      clearTimeout(this.#liveTimer);
      this.#liveTimer = setTimeout(() => this.#refreshLive(), 120);
    });

    this.scanner = new CameraScanner(this.video, (text) => this.scan(text, { source: 'camera' }));
    this.keyboard = new KeyboardScanner((text, meta) => this.scan(text, meta));
    this.keyboard.start();

    // A tap anywhere is enough of a gesture to unlock audio, so the first scan
    // already makes a sound.
    document.addEventListener('pointerdown', () => warmUp(), { once: true });
    window.addEventListener('hashchange', () => this.#route());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.scanner.stop();
    });

    // Losing the network now stops the work, so it is watched rather than
    // discovered on the next failed write.
    addEventListener('online', () => this.checkConnection());
    addEventListener('offline', () => this.checkConnection());

    this.#renderTabbar();
    await this.#route();
    this.checkConnection();
  }

  // ── the scan pipeline ────────────────────────────────────────────────────

  /**
   * Everything that can produce a code ends up here. `parseScan` decides
   * whether it is a Format A URL, a bare ID, or noise; the state machine
   * decides what it means; this method performs it.
   */
  async scan(text, meta = {}) {
    const source = meta.source ?? 'manual';
    const parsed = parseScan(text, { alsoAccept: [location.origin + location.pathname] });
    if (!parsed.ok) {
      if (parsed.reason === 'empty') return;
      play('error');
      this.toast(parsed.reason === 'foreign-url' ? 'That QR is not one of ours' : `Unreadable: ${text}`, 'bad');
      return;
    }

    const { id } = parsed;
    const thing = (await this.catalog.get(id)) ?? null;
    const { intent, session } = decideScan(this.session, { id, ts: Date.now(), thing, source });
    if (intent.type === 'ignore') return;

    await this.#setSession(session);
    this.lastThing = thing;
    play(cueFor(intent));
    if (source === 'hid') this.toast('Ring scanner', 'muted');

    await this.#perform(intent, thing);
  }

  async #perform(intent, thing) {
    switch (intent.type) {
      case 'show':
        return this.open(intent.id);

      case 'peek':
        this.toast(`${displayName(thing)} — already here`, 'muted');
        return this.open(intent.id);

      case 'enroll':
        this.#pendingEnroll = { id: intent.id, packInto: intent.packInto };
        return this.#mount(enrollView(this, this.#pendingEnroll));

      case 'pack': {
        await this.attempt(() => this.catalog.packInto(intent.id, intent.into), {
          failure: `${displayName(thing)} was NOT packed`,
        });
        this.toast(
          intent.from
            ? `${displayName(thing)} moved from ${intent.from}`
            : `${displayName(thing)} packed`,
          'good',
        );
        return this.#refreshChrome();
      }

      case 'ask-switch-target':
        askSheet({
          title: `Switch to packing into ${displayName(thing)}?`,
          detail: `You are packing into ${this.targetName ?? this.session.target_id}. ` +
            'Scanning a different container is the one case that is genuinely ambiguous.',
          confirmLabel: 'Switch',
          cancelLabel: 'Stay',
          onConfirm: () => this.startPacking(intent.id),
          onCancel: () => this.open(intent.id),
        });
        return;
    }
  }

  // ── enrolment ────────────────────────────────────────────────────────────

  async completeEnroll({ id, packInto, quick, fields }) {
    // The photo goes to shared storage first: the row carries URLs, so every
    // other screen can show the picture without asking the device that took it.
    const { photo, thumb, ...rest } = fields;
    await this.attempt(async () => {
      const urls = photo || thumb ? await this.catalog.uploadPhoto(id, { photo, thumb }) : {};
      await this.catalog.enroll({ id, ...rest, ...urls });
      if (packInto) await this.catalog.packInto(id, packInto);
    }, { failure: `${id} was NOT saved` });

    this.#pendingEnroll = null;
    await this.#setSession(finishEnroll(this.session, { packInto }));
    this.toast(
      `${fields.name?.trim() || id} enrolled${packInto ? ` → ${this.targetName ?? packInto}` : ''}`,
      'good',
    );
    play(packInto ? 'rising' : 'neutral');

    // Quick capture goes straight back to the viewfinder; a named save shows
    // what was just created so a mistake is visible immediately.
    if (quick || packInto) return this.go('#/scan');
    return this.open(id);
  }

  async cancelEnroll() {
    const packInto = this.#pendingEnroll?.packInto ?? null;
    this.#pendingEnroll = null;
    await this.#setSession(finishEnroll(this.session, { packInto }));
    return this.go('#/scan');
  }

  // ── actions ──────────────────────────────────────────────────────────────

  async startPacking(id) {
    await this.#setSession(startPacking(this.session, id));
    this.toast(`Packing into ${this.targetName ?? id}`, 'good');
    return this.go('#/scan');
  }

  async stopPacking() {
    await this.#setSession(stopPacking(this.session));
    return this.#refreshChrome();
  }

  async unpack(id) {
    await this.attempt(() => this.catalog.unpack(id), { failure: 'Not taken out' });
    this.toast('Taken out', 'good');
    return this.open(id, { replace: true });
  }

  async markGone(id) {
    await this.attempt(() => this.catalog.markGone(id), { failure: 'Not marked as gone' });
    this.toast('Marked as gone', 'good');
    return this.open(id, { replace: true });
  }

  async saveEdit(id, patch) {
    await this.attempt(
      () => this.catalog.update(id, patch, { type: patch.name !== undefined ? 'renamed' : 'moved' }),
      { failure: 'Changes were NOT saved' },
    );
    this.toast('Saved', 'good');
    return this.open(id, { replace: true });
  }

  async undo() {
    const undone = await this.attempt(() => this.catalog.undoLast(), { failure: 'Undo failed' });
    if (!undone) {
      play('error');
      return this.toast('Nothing left to undo', 'muted');
    }
    play('neutral');
    this.toast(`Undid ${undone.events.map((e) => e.type).join(' + ')}`, 'good');
    await this.refresh();
  }

  /**
   * Redraw after somebody else's write. ENROLL is exempt — half-typed text is
   * unrecoverable, and the person typing it is the one who needs it most.
   */
  async #refreshLive() {
    if (this.#current?.classList.contains('view--enroll')) return this.#refreshChrome();
    return this.#route();
  }

  // ── navigation ───────────────────────────────────────────────────────────

  go(route) {
    if (location.hash === route) return this.#route();
    location.hash = route;
  }

  open(id, { replace = false } = {}) {
    const route = `#${normalizeId(id)}`;
    if (replace && location.hash === route) return this.#route();
    return this.go(route);
  }

  /** Re-run the current route against fresh data. */
  refresh() {
    return this.#route();
  }

  async #route() {
    if (this.#navigating) return;
    this.#navigating = true;
    try {
      const hash = location.hash.replace(/^#/, '');
      this.session = await this.catalog.session();

      // A bare 4-character fragment is the QR deep link: same path whether it
      // arrived from the in-app scanner or the phone's stock camera app.
      if (isValidId(normalizeId(hash))) {
        const id = normalizeId(hash);
        const thing = await this.catalog.get(id);
        // A phone's stock camera opening the label URL arrives here, not
        // through the in-app scanner. It is a deliberate act, never a repeat
        // frame, so it is not subject to the cooldown.
        if (!thing) return void (await this.scan(id, { source: 'link' }));
        this.lastThing = thing;
        const [contents, trail] = await Promise.all([
          thing.is_container ? this.catalog.childrenOf(id) : [],
          this.catalog.breadcrumb(id),
        ]);
        return void this.#mount(thingView(this, { thing, contents, trail }));
      }

      const [, section, param] = hash.split('/');
      switch (section) {
        case 'search':
          return void this.#mount(searchView(this, { things: await this.catalog.all() }));
        case 'tree':
          return void this.#mount(treeView(this, { things: await this.catalog.all() }));
        case 'unnamed':
          return void this.#mount(unnamedView(this, { things: await this.catalog.all() }));
        case 'manifest': {
          const container = await this.catalog.get(param ?? '');
          if (!container) return void this.#mount(unknownView(this, param ?? '—'));
          const [contents, trail] = await Promise.all([
            this.catalog.childrenOf(container.id),
            this.catalog.breadcrumb(container.id),
          ]);
          return void this.#mount(manifestView(this, { container, contents, trail }));
        }
        case 'backup':
          return void this.#mount(backupView(this, await this.#backupContext()));
        case 'enroll':
          if (this.#pendingEnroll) return void this.#mount(enrollView(this, this.#pendingEnroll));
          return void this.go('#/scan');
        default:
          return void this.#mount(scanView(this));
      }
    } finally {
      this.#navigating = false;
      await this.#refreshChrome();
    }
  }

  async #mount(view) {
    if (this.#current?.destroy) this.#current.destroy();
    // The camera is only ever open on the screens that show a viewfinder;
    // leaving it running behind a list view drains the battery for nothing.
    if (!view.classList.contains('view--scan') && !view.classList.contains('view--enroll')) {
      // Optional chaining: the setup screen mounts before there is a scanner.
      this.scanner?.stop();
    }
    this.#current = view;
    this.#viewHost.replaceChildren(view);
    this.#viewHost.scrollTop = 0;
    await view.mounted?.();
  }

  async startCamera() {
    if (this.scanner.running) return true;
    try {
      await this.scanner.start();
      this.cameraError = null;
      return true;
    } catch (error) {
      this.cameraError =
        error.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow it in the address bar, or type codes below.'
          : `Camera unavailable: ${error.message}`;
      return false;
    }
  }

  // ── chrome ───────────────────────────────────────────────────────────────

  async #setSession(session) {
    this.session = await this.catalog.setSession(session);
    this.targetName = this.session.target_id
      ? displayName(await this.catalog.get(this.session.target_id))
      : null;
    await this.#refreshChrome();
  }

  async #refreshChrome() {
    const banners = [];

    if (this.session.mode === 'PACKING' && this.session.target_id) {
      if (!this.targetName) {
        this.targetName = displayName(await this.catalog.get(this.session.target_id));
      }
      const contents = await this.catalog.childrenOf(this.session.target_id);
      banners.push(
        h('div.banner.banner--packing', null,
          h('button.banner__main', { type: 'button', onClick: () => this.open(this.session.target_id) },
            h('span.banner__icon', null, '📦'),
            h('span.banner__text', null,
              h('b', null, `Packing into ${this.targetName}`),
              h('small', null, plural(contents.length, 'item')),
            ),
          ),
          h('button.btn.btn--ghost', { type: 'button', onClick: () => this.stopPacking() }, 'Done'),
        ),
      );
    }

    // The catalog now lives on a server, so losing the network stops the work
    // rather than degrading it. That has to be impossible to miss.
    if (!this.#online) {
      banners.push(
        h('div.banner.banner--offline', null,
          h('span.banner__icon', null, '⚠'),
          h('span.banner__text', null,
            h('b', null, 'No connection to the catalog'),
            h('small', null, 'Scans will not save until this clears'),
          ),
          h('button.btn.btn--ghost', { type: 'button', onClick: () => this.checkConnection() }, 'Retry'),
        ),
      );
    }

    this.#banner.replaceChildren(...banners);
    this.#renderTabbar();
  }

  /** @returns {Promise<boolean>} */
  async checkConnection() {
    const { ok } = await this.catalog.ping();
    const changed = ok !== this.#online;
    this.#online = ok;
    if (changed) {
      await this.#refreshChrome();
      if (ok) {
        this.toast('Back online', 'good');
        await this.#route();
      }
    }
    return ok;
  }

  async #backupContext() {
    const [eventCount, thingCount] = await Promise.all([
      this.catalog.eventCount(),
      this.catalog.count(),
    ]);
    return { eventCount, thingCount, online: this.#online };
  }

  #renderTabbar() {
    const hash = location.hash || '#/scan';
    const tab = (route, glyph, label) =>
      h('button.tab', {
        type: 'button',
        class: { 'tab--on': hash.startsWith(route) },
        onClick: () => this.go(route),
      }, h('span.tab__glyph', null, glyph), h('span.tab__label', null, label));

    this.#tabbar.replaceChildren(
      tab('#/scan', '⧉', 'Scan'),
      tab('#/search', '⌕', 'Search'),
      tab('#/tree', '⊞', 'Tree'),
      tab('#/unnamed', '✎', 'Unnamed'),
      h('button.tab.tab--undo', { type: 'button', onClick: () => this.undo() },
        h('span.tab__glyph', null, '↺'), h('span.tab__label', null, 'Undo')),
      tab('#/backup', '⬇', 'Backup'),
    );
  }

  toast(message, kind = 'muted', ms = 2600) {
    const node = h('div.toast', { class: `toast--${kind}` }, message);
    this.#toasts.append(node);
    setTimeout(() => {
      node.classList.add('toast--out');
      setTimeout(() => node.remove(), 200);
    }, ms);
  }

  /**
   * Every write goes through here. A failed save on a shared catalog is not a
   * cosmetic problem — somebody believes an item is in a box — so it is
   * reported loudly and the connection is rechecked.
   */
  async attempt(work, { failure = 'That did not save' } = {}) {
    try {
      const result = await work();
      if (!this.#online) await this.checkConnection();
      return result;
    } catch (error) {
      play('error');
      this.toast(`${failure}: ${error.message}`, 'bad', 5000);
      this.checkConnection();
      throw error;
    }
  }
}

/**
 * Shown when config.js has no Supabase project yet. The app is useless without
 * one, so this says exactly what to do rather than failing at the first write.
 */
function setupView() {
  const step = (title, detail) =>
    h('li.setup__step', null, h('b', null, title), h('p', null, detail));

  return h('section.view.view--list', null,
    h('div.section__head', null, h('h2', null, 'Connect the catalog')),
    h('div.card-block.card-block--warn', null,
      h('b', null, 'No database configured'),
      h('p', null,
        'This catalog is shared: one database, every phone and laptop. It needs a ' +
        'Supabase project before anything can be scanned.'),
    ),
    h('ol.setup', null,
      step('Create a free Supabase project',
        'supabase.com/dashboard — any region near you.'),
      step('Run the schema',
        'Open the SQL editor, paste all of supabase/schema.sql, run it once.'),
      step('Paste two values into config.js',
        'Project Settings → API: the Project URL and the anon public key. ' +
        'Not the service_role key — that one bypasses every access rule.'),
      step('Redeploy',
        'Commit and push; GitHub Pages rebuilds in about a minute.'),
    ),
  );
}
