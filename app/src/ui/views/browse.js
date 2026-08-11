import { CONTAINER_KINDS } from '../../../../config.js';
import { searchThings } from '../../core/search.js';
import { h, plural } from '../dom.js';
import { countLine, displayName, emptyState, icon, thingRow, thumbnail } from '../components.js';
import { urlPool } from '../../platform/images.js';

/**
 * Search across name/tags/notes. Typing a 4-character code by hand
 * resolves to exactly the same thing as scanning it — that equivalence is why
 * the label carries the ID in large type.
 */
export function searchView(app, { things, initialQuery = '' }) {
  const pool = urlPool();
  const filters = { q: initialQuery, unpacked: false, unnamed: false, containerKind: null };
  const results = h('div.list');

  const input = h('input.search__input', {
    type: 'search',
    value: initialQuery,
    placeholder: 'Name, tag, note, or a 4-character code',
    autocomplete: 'off',
    'aria-label': 'Search',
    onInput: (e) => {
      filters.q = e.target.value;
      run();
    },
  });

  const summary = h('div.section__count');

  function toggle(key, label) {
    return h('button.chip', {
      type: 'button',
      class: { 'chip--on': filters[key] },
      'aria-pressed': String(Boolean(filters[key])),
      onClick: (e) => {
        filters[key] = !filters[key];
        e.currentTarget.classList.toggle('chip--on', filters[key]);
        e.currentTarget.setAttribute('aria-pressed', String(filters[key]));
        run();
      },
    }, label);
  }

  const kindFilter = h('div.chips', null, CONTAINER_KINDS.map((kind) =>
    h('button.chip', {
      type: 'button',
      onClick: (e) => {
        filters.containerKind = filters.containerKind === kind ? null : kind;
        for (const chip of kindFilter.children) chip.classList.remove('chip--on');
        if (filters.containerKind) e.currentTarget.classList.add('chip--on');
        run();
      },
    }, `${icon({ is_container: true, container_kind: kind })} ${kind}`)));

  function run() {
    pool.release();
    const found = searchThings(things, filters);
    summary.textContent = found.length ? countLine(found) : 'nothing found';
    results.replaceChildren(
      ...(found.length
        ? found.slice(0, 300).map((thing) => thingRow(thing, pool, { onClick: () => app.open(thing.id) }))
        : [emptyState('No matches', 'Try a shorter word, or clear the filters.')]),
    );
  }

  const view = h('section.view.view--list', null,
    h('div.search__bar', null, input),
    h('div.search__filters', null,
      toggle('unpacked', 'Unpacked'),
      toggle('unnamed', 'Unnamed'),
    ),
    kindFilter,
    h('div.section__head', null, h('h2', null, 'Results'), summary),
    results,
  );

  run();
  view.mounted = () => input.focus();
  view.destroy = () => pool.release();
  return view;
}

/** Containers first, drill into contents. The physical hierarchy, browsable. */
export function treeView(app, { things }) {
  const pool = urlPool();
  const byParent = new Map();
  for (const thing of things) {
    const key = thing.parent_id ?? '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(thing);
  }
  const sort = (list) =>
    [...list].sort((a, b) =>
      Number(b.is_container) - Number(a.is_container) || displayName(a).localeCompare(displayName(b)));

  function node(thing, depth) {
    const children = sort(byParent.get(thing.id) ?? []);
    const gone = thing.status === 'gone';
    const label = h('button.tree__label', {
      type: 'button',
      class: { 'is-gone': gone },
      onClick: () => app.open(thing.id),
    },
      thumbnail(thing, pool, { size: 'sm' }),
      h('span.tree__name', null, displayName(thing)),
      gone ? h('span.tag.tag--gone', null, 'gone') : null,
      h('code.tree__id', null, thing.id),
      children.length ? h('span.tree__count', null, plural(children.length, 'inside', 'inside')) : null,
    );
    if (!children.length) return h('div.tree__leaf', { style: { '--depth': depth } }, label);
    return h('details.tree__branch', { style: { '--depth': depth }, open: depth === 0 },
      h('summary', null, label),
      children.map((child) => node(child, depth + 1)),
    );
  }

  const roots = sort(byParent.get('') ?? []);
  const view = h('section.view.view--list', null,
    h('div.section__head', null, h('h2', null, 'Catalog'), h('span.section__count', null, countLine(things))),
    roots.length
      ? h('div.tree', null, roots.map((thing) => node(thing, 0)))
      : emptyState('Nothing enrolled yet', 'Scan a label to add the first thing.'),
  );
  view.destroy = () => pool.release();
  return view;
}

/** The quick-capture cleanup queue — deliberately laptop-shaped. */
export function unnamedView(app, { things }) {
  const pool = urlPool();
  const pending = things.filter((t) => !t.name && t.status !== 'gone');

  const view = h('section.view.view--list', null,
    h('div.section__head', null,
      h('h2', null, 'Unnamed'),
      h('span.section__count', null, plural(pending.length, 'item')),
    ),
    pending.length
      ? h('div.list', null, pending.map((thing) => nameRow(thing)))
      : emptyState('Nothing to clean up', 'Every enrolled thing has a name.'),
  );

  function nameRow(thing) {
    const input = h('input.field__input', {
      type: 'text',
      placeholder: 'Name it',
      enterkeyhint: 'next',
      onKeydown: async (e) => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        await app.catalog.rename(thing.id, e.target.value.trim());
        app.toast(`${thing.id} named`, 'good');
        const next = row.nextElementSibling?.querySelector('input');
        row.remove();
        next?.focus();
      },
    });
    const row = h('div.namerow', null,
      h('button.namerow__thumb', { type: 'button', onClick: () => app.open(thing.id) },
        thumbnail(thing, pool, { size: 'md' })),
      h('div.namerow__body', null, input, h('code', null, thing.id)),
    );
    return row;
  }

  view.destroy = () => pool.release();
  return view;
}
