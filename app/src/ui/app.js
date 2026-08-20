import { isConfigured } from '../../../config.js';
import { isValidId, normalizeId } from '../../../shared/ids.js';
import { parseScan } from '../../../shared/payload.js';
import { RemoteCatalog } from '../core/remote.js';
import { currentHelper, signOut } from '../core/auth.js';
import { cueFor, decideScan, finishEnroll, startPacking, stopPacking } from '../core/machine.js';
import { CameraScanner, KeyboardScanner } from '../platform/scanner.js';
import { play, setMuted, warmUp } from '../platform/feedback.js';
import { h, plural } from './dom.js';
import { askSheet, displayName } from './components.js';
import { actionsFor } from '../core/capabilities.js';
import { scanView } from './views/scan.js';
import { enrollView } from './views/enroll.js';
import { thingView, unknownView } from './views/thing.js';
import { searchView, treeView, unnamedView } from './views/browse.js';
import { manifestView } from './views/manifest.js';
import { backupView } from './views/backup.js';
import { gateView } from './views/gate.js';

/**
 * The controller. It owns the catalog, the camera, the session, and the one
 * pipeline every scan flows through — camera, ring scanner, typed code and
 * `#ID` deep link all converge on `scan()`.
 */
export class App {
  catalog;
  session;
  /** Whose name goes on the events written from this device. */
  helper = null;
  scanner;
  keyboard;
  video;

  lastThing = null;
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
  #mountToken = 0;
  #routeAgain = false;
  #saving = false;

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

    // Nothing is loaded before this, deliberately: an unsigned browser gets no
    // rows from the database anyway, and a screen that flashes the catalog and
    // then covers it up would be worse than useless.
    const helper = await currentHelper(this.catalog.raw);
    if (!helper) return this.#mount(gateView(this));
    return this.#start(helper);
  }

  /** Called by the gate the moment a password is accepted. */
  enter(helper) {
    return this.#start(helper);
  }

  /**
   * Sign out this device. The session is the only thing on it, so this is the
   * whole of "log me off this phone" — everyone else stays signed in, and the
   * reload is what tears down the camera, the realtime channel and the routes
   * in one go rather than one by one.
   */
  async leave() {
    await signOut(this.catalog.raw);
    location.reload();
  }

  async #start(helper) {
    this.helper = helper;
    this.catalog.actor = helper;
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

    // A save is several round trips, and in packing mode the camera is still
    // pointed at the world the whole time. A scan landing mid-save used to
    // reopen ENROLL on the code that was already being written, and then fail
    // trying to enrol it twice.
    if (this.#saving) return;

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
        // Navigate rather than mounting directly. A view the address bar does
        // not know about is a view any later route will happily paint over —
        // and the later route is right, because the URL still says '#/scan'.
        this.#pendingEnroll = { id: intent.id, packInto: intent.packInto };
        return this.go('#/enroll');

      case 'pack': {
        const verdict = actionsFor(thing, { packingTarget: intent.into }).pack;
        if (!verdict.allowed) {
          // The only one worth a question: it was marked gone and here it is.
          if (thing?.status === 'gone') {
            play('query');
            askSheet({
              title: `${displayName(thing)} was marked gone`,
              detail: 'It was sold, donated or binned. Putting it in a box brings it back into ' +
                'the catalog as a real thing again.',
              confirmLabel: 'Bring it back',
              cancelLabel: 'Leave it gone',
              onConfirm: async () => {
                await this.attempt(() => this.catalog.restore(intent.id));
                await this.attempt(() => this.catalog.packInto(intent.id, intent.into));
                this.toast(`${displayName(thing)} restored and packed`, 'good', 5000, this.#undoAction());
                await this.#refreshChrome();
              },
              onCancel: () => this.open(intent.id),
            });
            return;
          }
          play('error');
          this.toast(verdict.reason, 'warn');
          return;
        }

        await this.attempt(() => this.catalog.packInto(intent.id, intent.into), {
          failure: `${displayName(thing)} was NOT packed`,
        });
        this.toast(
          intent.from
            ? `${displayName(thing)} moved from ${intent.from}`
            : `${displayName(thing)} packed`,
          'good',
          5000,
          this.#undoAction(),
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
    if (this.#saving) return;
    this.#saving = true;
    try {
      return await this.#completeEnroll({ id, packInto, quick, fields });
    } finally {
      this.#saving = false;
    }
  }

  async #completeEnroll({ id, packInto, quick, fields }) {
    // The photo goes to shared storage first: the row carries URLs, so every
    // other screen can show the picture without asking the device that took it.
    const { photo, thumb, ...rest } = fields;
    await this.attempt(async () => {
      // A photo that will not upload must not cost the item. What somebody
      // typed is the valuable part; the picture is a bonus, and losing the
      // whole enrolment over storage being misconfigured is the worse failure.
      let urls = {};
      if (photo || thumb) {
        try {
          urls = await this.catalog.uploadPhoto(id, { photo, thumb });
        } catch (error) {
          this.toast(`Saved without the photo: ${error.message}`, 'warn', 5000);
        }
      }
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

  /**
   * Pack a thing picked from the list instead of scanned. Same write, same
   * event, same undo — the only difference is that a tap is unambiguous, so a
   * container chosen deliberately is packed rather than treated as a request
   * to switch target.
   */
  async packExisting(id) {
    const thing = await this.catalog.get(id);
    if (!thing || !this.session.target_id) return;
    await this.attempt(() => this.catalog.packInto(id, this.session.target_id), {
      failure: `${displayName(thing)} was NOT packed`,
    });
    play('rising');
    this.toast(`${displayName(thing)} packed`, 'good', 5000, this.#undoAction());
    await this.#refreshChrome();
  }

  async unpack(id) {
    await this.attempt(() => this.catalog.unpack(id), { failure: 'Not taken out' });
    this.toast('Taken out', 'good');
    return this.open(id, { replace: true });
  }

  async markGone(id) {
    const released = await this.attempt(() => this.catalog.markGone(id), { failure: 'Not marked as gone' });
    this.toast('Marked as gone', 'good', 5000, this.#undoAction());
    return this.open(id, { replace: true });
  }

  async restore(id) {
    await this.attempt(() => this.catalog.restore(id), { failure: 'Not restored' });
    this.toast('Back in the catalog', 'good', 5000, this.#undoAction());
    return this.open(id, { replace: true });
  }

  async emptyContainer(id) {
    const emptied = await this.attempt(() => this.catalog.emptyContainer(id), { failure: 'Not emptied' });
    this.toast(`${plural(emptied?.length ?? 0, 'thing')} back in the catalog`, 'good', 5000, this.#undoAction());
    return this.open(id, { replace: true });
  }

  /** Pack from the thing's own page, choosing the box rather than scanning it. */
  async packIntoBox(id, boxId) {
    const thing = await this.catalog.get(id);
    await this.attempt(() => this.catalog.packInto(id, boxId), {
      failure: `${displayName(thing)} was NOT packed`,
    });
    play('rising');
    this.toast(`${displayName(thing)} → ${displayName(await this.catalog.get(boxId))}`, 'good', 5000, this.#undoAction());
    return this.open(id, { replace: true });
  }

  /**
   * Free a label so it can be scanned onto something else. The old record is
   * retired, not overwritten, and stays in the catalog with its history.
   */
  async recode(id) {
    const result = await this.attempt(() => this.catalog.recode(id), { failure: 'The label was not freed' });
    if (!result) return;
    this.toast(`${result.freed} is free — scan it onto the new thing`, 'good', 6000);
    return this.go('#/scan');
  }

  async saveEdit(id, patch) {
    await this.attempt(
      () => this.catalog.update(id, patch, { type: patch.name !== undefined ? 'renamed' : 'moved' }),
      { failure: 'Changes were NOT saved' },
    );
    this.toast('Saved', 'good');
    return this.open(id, { replace: true });
  }

  /**
   * Reverse one specific action — the one whose toast is on screen.
   *
   * Not "the last action", which on a shared catalog may be a helper's scan
   * from two seconds ago. Undo is offered for a few seconds next to the thing
   * it would reverse, and nowhere else; a permanent button invites exactly the
   * accident it is supposed to fix.
   */
  async undoGroup(group) {
    const undone = await this.attempt(() => this.catalog.undoGroup(group), { failure: 'Undo failed' });
    if (!undone) {
      play('error');
      return this.toast('That has already been undone', 'muted');
    }
    play('neutral');
    this.toast('Undone', 'good');
    await this.refresh();
  }

  /**
   * Redraw after somebody else's write. ENROLL is exempt — half-typed text is
   * unrecoverable, and the person typing it is the one who needs it most.
   */
  async #refreshLive() {
    if (this.#current?.classList.contains('view--enroll')) return this.#refreshChrome();

    // A view that can update itself does so. Re-routing rebuilds the whole
    // screen, which during a packing run means the pick-list blanks and the
    // viewfinder restarts on every single write — including other people's.
    if (this.#current?.live) {
      await this.#current.live();
      return this.#refreshChrome();
    }
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
    // Dropping a concurrent route leaves the screen showing the previous one
    // while the address says otherwise. Remember it and run it after.
    if (this.#navigating) {
      this.#routeAgain = true;
      return;
    }
    this.#navigating = true;

    /**
     * A route reads the network before it can render. A scan in the meantime
     * mounts ENROLL immediately — and without this the slower route would
     * paint over it a moment later, losing the code the person just scanned.
     */
    const token = this.#mountToken;
    const stale = () => this.#mountToken !== token;

    try {
      const hash = location.hash.replace(/^#/, '');
      this.session = await this.catalog.session();
      if (stale()) return;

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
        if (stale()) return;
        return void this.#mount(thingView(this, { thing, contents, trail }));
      }

      const [, section, param] = hash.split('/');
      if (stale()) return;
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
      if (this.#routeAgain) {
        this.#routeAgain = false;
        await this.#route();
      }
    }
  }

  async #mount(view) {
    this.#mountToken++;
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
      tab('#/tree', '⊞', 'Catalog'),
      tab('#/unnamed', '✎', 'Unnamed'),
      tab('#/backup', '⬇', 'Backup'),
    );
  }

  #undoAction() {
    const group = this.catalog.lastGroup;
    return group ? { label: 'Undo', onClick: () => this.undoGroup(group) } : null;
  }

  toast(message, kind = 'muted', ms = 2600, action = null) {
    const node = h('div.toast', { class: `toast--${kind}` },
      h('span', null, message),
      action
        ? h('button.toast__action', {
            type: 'button',
            onClick: () => {
              node.remove();
              action.onClick();
            },
          }, action.label)
        : null,
    );
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
