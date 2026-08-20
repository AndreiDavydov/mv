import { h } from '../dom.js';
import { NAME_MAX, rememberedName, signIn } from '../../core/auth.js';
import { parseScan } from '../../../../shared/payload.js';

/**
 * The locked page. Everything a stranger who scans a box ever sees.
 *
 * There is nothing behind it to protect by hiding: `anon` holds no privilege
 * on any table, so an unauthenticated browser gets zero rows whatever it asks
 * for. This screen is therefore honest rather than a curtain — which is also
 * why it can afford to show a password field instead of pretending the site
 * does not exist. A stranger sees a wall; a friend types one word.
 */
export function gateView(app) {
  const scanned = scannedId();

  const name = h('input.field__input', {
    type: 'text',
    autocomplete: 'nickname',
    maxlength: String(NAME_MAX),
    placeholder: 'Andrey',
    value: rememberedName(),
    enterkeyhint: 'next',
  });

  const password = h('input.field__input', {
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'The word you were told',
    enterkeyhint: 'go',
  });

  const problem = h('p.gate__problem', { role: 'alert' });
  const button = h('button.btn.btn--big.btn--primary', { type: 'submit' }, 'Open the catalog');

  async function attempt(event) {
    event.preventDefault();
    problem.textContent = '';
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const who = await signIn(app.catalog.raw, { name: name.value, password: password.value });
      await app.enter(who);
    } catch (error) {
      problem.textContent = error.message;
      button.disabled = false;
      button.textContent = 'Open the catalog';
      password.select();
    }
  }

  const form = h('form.gate__form', { onSubmit: attempt },
    h('label.field', null, h('span.field__label', null, 'Your name'), name),
    h('label.field', null, h('span.field__label', null, 'Password'), password),
    problem,
    h('div.enroll__actions', null, button),
  );

  // Focus whichever box is actually empty — a returning helper only needs the
  // password, and on a phone the wrong autofocus costs a tap and a keyboard.
  queueMicrotask(() => (name.value ? password : name).focus());

  return h('section.view.view--list.gate', null,
    h('div.gate__head', null,
      h('h2', null, 'Private catalog'),
      h('p.muted', null,
        scanned
          ? `This is someone's moving inventory. You scanned ${scanned}; it will open once you are in.`
          : 'This is someone\'s moving inventory. It is not open to the public.'),
    ),
    form,
    h('p.gate__foot.muted', null,
      'Your name is not a password — it is stamped on everything you scan, so the ' +
      'history says who did what. Nothing on this page is stored on your phone ' +
      'except the fact that you are signed in.'),
  );
}

/** The ID in the URL, if a scan is what brought this browser here. */
function scannedId() {
  const parsed = parseScan(location.hash.replace(/^#/, ''));
  return parsed.ok ? parsed.id : null;
}
