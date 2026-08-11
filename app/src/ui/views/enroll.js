import { h } from '../dom.js';
import { kindChips, roomChips, thumbnail } from '../components.js';
import { derivePhotos, urlPool } from '../../platform/images.js';

/**
 * The fastest screen in the app. A code that has never been seen lands here
 * automatically with the viewfinder already live — there is no "tap to start",
 * because that tap, times three hundred items, is the whole project.
 *
 * Two ways out:
 *   Save          photo + name + kind, then back to wherever the scan came from
 *   Quick capture photo only, straight back to the viewfinder for the next item
 */
export function enrollView(app, { id, packInto }) {
  const pool = urlPool();
  const draft = {
    photo: null,
    thumb: null,
    is_container: false,
    container_kind: 'box',
    room: app.lastRoom ?? null,
  };

  const shutter = h('button.shutter', {
    type: 'button',
    'aria-label': 'Take photo',
    onClick: () => capture(),
  });

  const preview = h('div.enroll__preview');
  const stage = h('div.enroll__stage', null, app.video, shutter);

  /**
   * The OS camera as a fallback: no in-app viewfinder, one round trip, but it
   * works when getUserMedia does not — a refused permission or a browser that
   * will not open a stream should not cost the photo.
   */
  const filePicker = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    style: { display: 'none' },
    onChange: async (e) => {
      const [file] = e.target.files;
      e.target.value = '';
      if (file) await useImage(file);
    },
  });
  const pickButton = h('button.btn.enroll__pick.is-hidden',
    { type: 'button', onClick: () => filePicker.click() }, '📷 Take a photo');

  const name = h('input.field__input', {
    type: 'text',
    // Autofocused so the phone keyboard is already up and its mic key is one
    // tap away — dictating "cast iron pan" is faster than typing it.
    autofocus: true,
    autocomplete: 'off',
    enterkeyhint: 'done',
    placeholder: 'Name (optional)',
    'aria-label': 'Name',
    onKeydown: (e) => e.key === 'Enter' && save(),
  });

  const kindRow = h('div.enroll__kinds.is-hidden', null,
    kindChips(draft.container_kind, (kind) => {
      draft.container_kind = kind;
      rerenderChips();
    }));

  const containerToggle = h(
    'label.toggle',
    null,
    h('input', {
      type: 'checkbox',
      onChange: (e) => {
        draft.is_container = e.target.checked;
        kindRow.classList.toggle('is-hidden', !draft.is_container);
      },
    }),
    h('span', null, 'This is a container'),
  );

  const roomRow = h('div.enroll__rooms', null,
    roomChips(draft.room, (room) => {
      draft.room = room;
      app.lastRoom = room;
      rerenderRooms();
    }));

  function rerenderChips() {
    kindRow.replaceChildren(kindChips(draft.container_kind, (kind) => {
      draft.container_kind = kind;
      rerenderChips();
    }));
  }
  function rerenderRooms() {
    roomRow.replaceChildren(roomChips(draft.room, (room) => {
      draft.room = room;
      app.lastRoom = room;
      rerenderRooms();
    }));
  }

  async function capture() {
    try {
      shutter.disabled = true;
      const frame = await app.scanner.grabFrame();
      await useImage(frame);
      frame.close?.();
    } catch (error) {
      app.toast(`Could not take the photo: ${error.message}`, 'bad');
    } finally {
      shutter.disabled = false;
    }
  }

  async function useImage(source) {
    Object.assign(draft, await derivePhotos(source));
    pool.release();
    preview.replaceChildren(thumbnail(draft, pool, { size: 'lg' }));
    preview.classList.add('is-set');
    name.focus();
  }

  async function save({ quick = false } = {}) {
    try {
      await app.completeEnroll({
        id,
        packInto,
        quick,
        fields: {
          name: quick ? null : name.value,
          photo: draft.photo,
          thumb: draft.thumb,
          is_container: quick ? false : draft.is_container,
          container_kind: draft.container_kind,
          room: quick ? (app.lastRoom ?? null) : draft.room,
        },
      });
    } catch (error) {
      app.toast(error.message, 'bad');
    }
  }

  const view = h(
    'section.view.view--enroll',
    null,
    h('header.enroll__head', null,
      h('div.enroll__id', null, h('span', null, 'New'), h('code', null, id)),
      packInto
        ? h('div.pill.pill--packing', null, `→ ${app.targetName ?? packInto}`)
        : null,
      h('button.btn.btn--ghost', { type: 'button', onClick: () => app.cancelEnroll() }, 'Cancel'),
    ),
    stage,
    pickButton,
    filePicker,
    preview,
    h('div.enroll__form', null,
      h('div.field', null, name),
      containerToggle,
      kindRow,
      h('div.field__label', null, 'Room'),
      roomRow,
    ),
    h('div.enroll__actions', null,
      h('button.btn.btn--big', { type: 'button', onClick: () => save({ quick: true }) },
        'Quick capture', h('small', null, 'photo only, straight to the next code')),
      h('button.btn.btn--big.btn--primary', { type: 'button', onClick: () => save() }, 'Save'),
    ),
  );

  view.mounted = async () => {
    const live = await app.startCamera();
    stage.classList.toggle('is-hidden', !live);
    pickButton.classList.toggle('is-hidden', live);
    name.focus();
  };
  view.destroy = () => pool.release();
  return view;
}
