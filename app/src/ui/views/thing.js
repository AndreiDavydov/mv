import { h, plural, timeAgo } from '../dom.js';
import {
  askSheet,
  breadcrumbLine,
  countLine,
  displayName,
  emptyState,
  icon,
  kindChips,
  thumbnail,
} from '../components.js';
import { urlPool } from '../../platform/images.js';

/** LOOKUP: what a known code shows. Containers additionally show their contents. */
export function thingView(app, { thing, contents, trail }) {
  const pool = urlPool();

  const view = h(
    'section.view.view--thing',
    null,
    h('div.thing__hero', null,
      thumbnail(thing, pool, { size: 'xl' }),
      h('div.thing__headline', null,
        h('h1.thing__name', null, displayName(thing)),
        h('div.thing__meta', null,
          h('code.thing__id', null, thing.id),
          h('span.pill', { class: `pill--${thing.status}` }, thing.status),
          thing.is_container ? h('span.pill', null, `${icon(thing)} ${thing.container_kind}`) : null,
        ),
        breadcrumbLine(trail, (id) => app.open(id)),
      ),
    ),

    thing.tags?.length
      ? h('div.chips.chips--static', null, thing.tags.map((t) => h('span.chip', null, `#${t}`)))
      : null,
    thing.notes ? h('p.thing__notes', null, thing.notes) : null,

    thing.is_container ? contentsBlock(app, thing, contents, pool) : null,

    h('div.thing__actions', null,
      thing.is_container
        ? h('button.btn.btn--big.btn--primary', {
            type: 'button',
            onClick: () => app.startPacking(thing.id),
          }, 'Pack into this')
        : null,
      thing.parent_id
        ? h('button.btn.btn--big', { type: 'button', onClick: () => app.unpack(thing.id) }, 'Take out')
        : null,
      h('button.btn.btn--big', { type: 'button', onClick: () => edit() }, 'Edit'),
      thing.is_container
        ? h('button.btn.btn--big', {
            type: 'button',
            onClick: () => app.go(`#/manifest/${thing.id}`),
          }, 'Print manifest')
        : null,
      thing.status === 'gone'
        ? null
        : h('button.btn.btn--big.btn--danger', { type: 'button', onClick: () => markGone() }, 'Gone'),
    ),

    historyBlock(app, thing),
  );

  function edit() {
    view.replaceChildren(editForm(app, thing, pool));
  }

  function markGone() {
    askSheet({
      title: `Mark ${displayName(thing)} as gone?`,
      detail: 'Sold, donated or binned. It stays in the catalog and in the event log, ' +
        'so the history of the move stays honest.',
      confirmLabel: 'Mark as gone',
      onConfirm: () => app.markGone(thing.id),
    });
  }

  view.destroy = () => pool.release();
  return view;
}

function contentsBlock(app, thing, contents, pool) {
  return h(
    'section.contents',
    null,
    h('div.section__head', null,
      h('h2', null, 'Contents'),
      h('span.section__count', null, contents.length ? countLine(contents) : 'empty'),
    ),
    contents.length
      ? h('div.grid', null, contents.map((child) =>
          h('button.card', { type: 'button', onClick: () => app.open(child.id) },
            thumbnail(child, pool, { size: 'md' }),
            h('div.card__name', null, displayName(child)),
            h('code.card__id', null, child.id),
          )))
      : h('p.muted', null, 'Nothing packed in here yet.'),
  );
}

function historyBlock(app, thing) {
  const list = h('div.history__list', null, h('p.muted', null, 'Loading…'));
  const block = h('details.history', null,
    h('summary', null, 'History'),
    list,
  );
  block.addEventListener('toggle', async () => {
    if (!block.open) return;
    const events = await app.catalog.events({ thingId: thing.id });
    list.replaceChildren(
      ...(events.length
        ? events.reverse().map((event) =>
            h('div.history__row', null,
              h('span.history__type', { class: `history__type--${event.type}` }, event.type),
              h('span.history__where', null, event.parent_id ? `→ ${event.parent_id}` : ''),
              h('time.history__when', null, timeAgo(event.ts)),
            ))
        : [h('p.muted', null, 'No events.')]),
    );
  }, { once: false });
  return block;
}

function editForm(app, thing, pool) {
  const draft = {
    name: thing.name ?? '',
    notes: thing.notes ?? '',
    tags: (thing.tags ?? []).join(' '),
    is_container: thing.is_container,
    container_kind: thing.container_kind ?? 'box',
  };

  const kindRow = h('div', { class: { 'is-hidden': !draft.is_container } });
  const renderKind = () => kindRow.replaceChildren(kindChips(draft.container_kind, (k) => {
    draft.container_kind = k;
    renderKind();
  }));
  renderKind();

  return h('form.edit', {
    onSubmit: (e) => {
      e.preventDefault();
      app.saveEdit(thing.id, {
        name: draft.name.trim() || null,
        notes: draft.notes.trim() || null,
        tags: draft.tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean),
        is_container: draft.is_container,
        container_kind: draft.container_kind,
      });
    },
  },
    h('h2', null, `Edit ${thing.id}`),
    field('Name', h('input.field__input', {
      type: 'text', value: draft.name, autofocus: true,
      onInput: (e) => (draft.name = e.target.value),
    })),
    h('label.toggle', null,
      h('input', {
        type: 'checkbox', checked: draft.is_container,
        onChange: (e) => {
          draft.is_container = e.target.checked;
          kindRow.classList.toggle('is-hidden', !draft.is_container);
        },
      }),
      h('span', null, 'This is a container'),
    ),
    kindRow,
    field('Tags', h('input.field__input', {
      type: 'text', value: draft.tags, placeholder: 'kitchen fragile',
      onInput: (e) => (draft.tags = e.target.value),
    })),
    field('Notes', h('textarea.field__input', {
      rows: 3, value: draft.notes,
      onInput: (e) => (draft.notes = e.target.value),
    })),
    h('div.enroll__actions', null,
      h('button.btn.btn--big', { type: 'button', onClick: () => app.open(thing.id) }, 'Cancel'),
      h('button.btn.btn--big.btn--primary', { type: 'submit' }, 'Save'),
    ),
  );
}

function field(label, input) {
  return h('label.field', null, h('span.field__label', null, label), input);
}

export function unknownView(app, id) {
  return h('section.view', null,
    emptyState(
      `${id} is not enrolled`,
      'This code has never been scanned. Scan it again to enrol it, or go back to the scanner.',
      h('button.btn.btn--big.btn--primary', { type: 'button', onClick: () => app.go('#/scan') }, 'Scanner'),
    ),
  );
}

export { plural };
