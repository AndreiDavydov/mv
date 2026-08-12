import { CONTAINER_KINDS } from '../../../config.js';
import { h, plural } from './dom.js';

export const KIND_ICON = {
  box: '📦',
  suitcase: '🧳',
  crate: '🗄️',
  bag: '👜',
};

export function icon(thing) {
  if (!thing) return '❔';
  return thing.is_container ? (KIND_ICON[thing.container_kind] ?? '📦') : '🏷️';
}

export function displayName(thing) {
  if (!thing) return 'Unknown';
  return thing.name || `Unnamed ${thing.id}`;
}

/** A photo thumbnail, or the item icon when there is no photo yet. */
export function thumbnail(thing, pool, { size = 'md' } = {}) {
  const url = pool.for(thing?.thumb ?? thing?.photo);
  return url
    ? h(`img.thumb.thumb--${size}`, { src: url, alt: '', loading: 'lazy' })
    : h(`div.thumb.thumb--${size}.thumb--empty`, null, icon(thing));
}

/** One row in a list of things. */
export function thingRow(thing, pool, { onClick, trailing = null, subtitle = null } = {}) {
  return h(
    'button.row',
    { onClick, type: 'button', class: { 'is-gone': thing.status === 'gone' } },
    thumbnail(thing, pool, { size: 'sm' }),
    h(
      'div.row__text',
      null,
      h('div.row__title', null,
        displayName(thing),
        thing.status === 'gone' ? h('span.tag.tag--gone', null, 'gone') : null),
      h('div.row__sub', null, subtitle ?? statusLine(thing)),
    ),
    h('code.row__id', null, thing.id),
    trailing,
  );
}

export function statusLine(thing) {
  const bits = [];
  if (thing.is_container) bits.push(thing.container_kind);
  bits.push(thing.status);
  if (thing.tags?.length) bits.push(thing.tags.map((t) => `#${t}`).join(' '));
  return bits.join(' · ');
}

export function breadcrumbLine(trail, onOpen) {
  if (!trail.length) return h('div.breadcrumb.breadcrumb--loose', null, 'Not in a container');
  return h(
    'div.breadcrumb',
    null,
    trail.map((parent, i) => [
      i > 0 ? h('span.breadcrumb__sep', null, '→') : null,
      h('button.breadcrumb__link', { type: 'button', onClick: () => onOpen(parent.id) },
        `${icon(parent)} ${displayName(parent)}`),
    ]),
  );
}

/** Selectable chips. `value` may be null; clicking the active chip clears it. */
export function chipGroup(values, selected, onSelect, { allowClear = true } = {}) {
  return h(
    'div.chips',
    null,
    values.map((value) =>
      h(
        'button.chip',
        {
          type: 'button',
          class: { 'chip--on': value === selected },
          'aria-pressed': String(value === selected),
          onClick: () => onSelect(value === selected && allowClear ? null : value),
        },
        value,
      ),
    ),
  );
}

export const kindChips = (selected, onSelect) =>
  chipGroup(CONTAINER_KINDS, selected, onSelect, { allowClear: false });

export function emptyState(title, detail, action = null) {
  return h('div.empty', null, h('h2', null, title), h('p', null, detail), action);
}

export function countLine(things) {
  const containers = things.filter((t) => t.is_container).length;
  return `${plural(things.length - containers, 'item')} · ${plural(containers, 'container')}`;
}

/**
 * Pick one of a list. Used for "put this in…", where the alternative is making
 * someone walk to the box, open packing mode and scan the thing they are
 * already looking at.
 */
export function chooseSheet({ title, detail, options, onPick, onCancel, empty = 'Nothing to choose from.' }) {
  const close = (fn, arg) => () => {
    sheet.remove();
    fn?.(arg);
  };
  const sheet = h(
    'div.sheet-backdrop',
    { onClick: (e) => e.target === sheet && close(onCancel)() },
    h(
      'div.sheet',
      { role: 'dialog', 'aria-modal': 'true' },
      h('h2.sheet__title', null, title),
      detail ? h('p.sheet__detail', null, detail) : null,
      options.length
        ? h('div.list.sheet__list', null, options.map((option) =>
            h('button.row', { type: 'button', onClick: close(onPick, option.value) },
              h('div.row__text', null,
                h('div.row__title', null, option.label),
                option.sub ? h('div.row__sub', null, option.sub) : null),
              option.code ? h('code.row__id', null, option.code) : null,
            )))
        : h('p.muted', null, empty),
      h('div.sheet__actions', null,
        h('button.btn', { type: 'button', onClick: close(onCancel) }, 'Cancel')),
    ),
  );
  document.body.append(sheet);
  return sheet;
}

/**
 * A yes/no question. The only one in the scan loop is "switch to packing into
 * X?", which earns it by being genuinely ambiguous.
 */
export function askSheet({ title, detail, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }) {
  const close = (fn) => () => {
    sheet.remove();
    fn?.();
  };
  const sheet = h(
    'div.sheet-backdrop',
    { onClick: (e) => e.target === sheet && close(onCancel)() },
    h(
      'div.sheet',
      { role: 'dialog', 'aria-modal': 'true' },
      h('h2.sheet__title', null, title),
      detail ? h('p.sheet__detail', null, detail) : null,
      h(
        'div.sheet__actions',
        null,
        h('button.btn', { type: 'button', onClick: close(onCancel) }, cancelLabel),
        h('button.btn.btn--primary', { type: 'button', onClick: close(onConfirm) }, confirmLabel),
      ),
    ),
  );
  document.body.append(sheet);
  sheet.querySelector('.btn--primary').focus();
  return sheet;
}
