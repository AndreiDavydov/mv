import { h } from '../dom.js';
import { kindChips } from '../components.js';
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
  };

  const shutter = h('button.shutter', {
    type: 'button',
    'aria-label': 'Take photo',
    onClick: () => capture(),
  });

  const shot = h('img.enroll__shot', { alt: '' });
  const retake = h('button.btn.btn--ghost.enroll__retake',
    { type: 'button', onClick: () => reopenCamera() }, 'Retake');
  const captured = h('div.enroll__captured.is-hidden', null, shot, retake);

  // An unlabelled circle over a video is not a photo button to anyone who has
  // not been told. Say what it does.
  const stageHint = h('p.enroll__stage-hint', null, 'Tap the circle to photograph it');
  const stage = h('div.enroll__stage', null, app.video, shutter, stageHint);

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

  /**
   * Shown while getUserMedia is still deciding — on a phone that is a permission
   * prompt, and a blank gap where the photo option should be reads as "there is
   * no photo option".
   */
  const stageWaiting = h('p.enroll__waiting', null, 'Starting the camera…');

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

  function rerenderChips() {
    kindRow.replaceChildren(kindChips(draft.container_kind, (kind) => {
      draft.container_kind = kind;
      rerenderChips();
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

    /*
     * The upload starts here rather than at Save.
     *
     * Naming a thing takes a few seconds of typing, and the photo is the one
     * part of the save that moves real bytes over a phone's connection. Sending
     * it while the keyboard is up costs nothing and takes the slowest step off
     * the critical path entirely — by the time Save is pressed the URLs are
     * usually already in hand.
     */
    draft.uploading = app.catalog
      .uploadPhoto(id, { photo: draft.photo, thumb: draft.thumb })
      .catch((error) => ({ error }));

    pool.release();
    shot.src = pool.for(draft.thumb) ?? pool.for(draft.photo);
    captured.classList.remove('is-hidden');

    /*
     * The camera goes off the moment there is a picture. It was running through
     * the whole naming step — decoding QR frames at a thing that is not a label
     * — which is heat, battery, and a viewfinder taking up the half of the
     * screen the keyboard was about to want.
     */
    app.stopCamera();
    stage.classList.add('is-hidden');
    pickButton.classList.add('is-hidden');
    name.focus();
  }

  async function reopenCamera() {
    captured.classList.add('is-hidden');
    const live = await app.startCamera();
    stage.classList.toggle('is-hidden', !live);
    pickButton.classList.toggle('is-hidden', live);
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
          uploading: draft.uploading,
          is_container: quick ? false : draft.is_container,
          container_kind: draft.container_kind,
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
    stageWaiting,
    pickButton,
    filePicker,
    h('div.enroll__form', null,
      // The picture and the name sit side by side once there is a picture, so
      // that both are on screen with the keyboard up. A full-width viewfinder
      // above a full-width field is two things and room for one.
      h('div.enroll__named', null, captured, h('div.field.enroll__fields', null, name)),
      containerToggle,
      kindRow,
    ),
    h('div.enroll__actions', null,
      h('button.btn.btn--big', { type: 'button', onClick: () => save({ quick: true }) },
        'Quick capture', h('small', null, 'photo only, straight to the next code')),
      h('button.btn.btn--big.btn--primary', { type: 'button', onClick: () => save() }, 'Save'),
    ),
  );

  view.mounted = async () => {
    // Hide both photo affordances until we know which one applies, and say so —
    // an empty gap where the camera should be reads as "there is no photo here".
    stage.classList.add('is-hidden');
    pickButton.classList.add('is-hidden');
    name.focus();

    const live = await app.startCamera();
    stageWaiting.classList.add('is-hidden');
    stage.classList.toggle('is-hidden', !live);
    pickButton.classList.toggle('is-hidden', live);
  };
  view.destroy = () => pool.release();
  return view;
}
