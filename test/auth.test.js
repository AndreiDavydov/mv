import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CREW_EMAIL } from '../config.js';

// The module reads localStorage at call time, not import time, so a stub is
// enough — and it keeps these tests honest about what is actually persisted.
globalThis.localStorage = {
  store: new Map(),
  getItem(key) { return this.store.has(key) ? this.store.get(key) : null; },
  setItem(key, value) { this.store.set(key, String(value)); },
  removeItem(key) { this.store.delete(key); },
};

const { NAME_MAX, cleanName, currentHelper, explain, rememberedName, signIn, signOut } =
  await import('../app/src/core/auth.js');

/** A stand-in for supabase-js: records what it was asked, answers as told. */
function fakeClient({ session = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      async getSession() { return { data: { session } }; },
      async signInWithPassword(credentials) {
        calls.push(credentials);
        return error ? { error } : { data: { session: {} }, error: null };
      },
      async signOut() { calls.push('signOut'); return { error: null }; },
    },
  };
}

test.beforeEach(() => localStorage.store.clear());

// ── names ──────────────────────────────────────────────────────────────────

test('a name is squeezed down to what belongs in a log line', () => {
  assert.equal(cleanName('  Andrey  '), 'Andrey');
  assert.equal(cleanName('Anna   Maria'), 'Anna Maria');
  assert.equal(cleanName('Line\nBreak'), 'Line Break');
  assert.equal(cleanName('x'.repeat(200)).length, NAME_MAX);
});

test('nothing usable comes back as empty rather than as whitespace', () => {
  for (const input of ['', '   ', '\n\t', null, undefined]) {
    assert.equal(cleanName(input), '', `${JSON.stringify(input)} should clean to ''`);
  }
});

// ── signing in ─────────────────────────────────────────────────────────────

test('the helper only ever supplies a password — the app knows the address', async () => {
  const client = fakeClient();
  const who = await signIn(client, { name: 'Andrey', password: 'hunter2' });

  assert.equal(who, 'Andrey');
  assert.deepEqual(client.calls, [{ email: CREW_EMAIL, password: 'hunter2' }]);
});

test('a name is required, because an unattributed log is the thing to avoid', async () => {
  const client = fakeClient();
  await assert.rejects(() => signIn(client, { name: '  ', password: 'hunter2' }), /name/i);
  assert.deepEqual(client.calls, [], 'must not even try the password without a name');
});

test('a missing password is refused before the round trip', async () => {
  const client = fakeClient();
  await assert.rejects(() => signIn(client, { name: 'Andrey', password: '' }), /password/i);
  assert.deepEqual(client.calls, []);
});

test('a rejected password leaves nothing behind on the device', async () => {
  const client = fakeClient({ error: { message: 'Invalid login credentials' } });
  await assert.rejects(() => signIn(client, { name: 'Andrey', password: 'wrong' }), /not right/);
  assert.equal(rememberedName(), '', 'a failed attempt must not remember the name');
});

test('the name is remembered so a returning helper types only the password', async () => {
  await signIn(fakeClient(), { name: '  Andrey ', password: 'hunter2' });
  assert.equal(rememberedName(), 'Andrey');
});

test('a helper whose storage is unavailable can still sign in', async () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  try {
    assert.equal(rememberedName(), '');
    assert.equal(await signIn(fakeClient(), { name: 'Andrey', password: 'hunter2' }), 'Andrey');
  } finally {
    globalThis.localStorage = real;
  }
});

// ── who is here ────────────────────────────────────────────────────────────

test('no session means no helper, whatever is left in storage', async () => {
  localStorage.setItem('app.helper', 'Andrey');
  assert.equal(await currentHelper(fakeClient({ session: null })), null);
});

test('a session with a forgotten name still gets in', async () => {
  assert.equal(await currentHelper(fakeClient({ session: {} })), 'someone');
});

test('signing out asks the client to drop the session', async () => {
  const client = fakeClient({ session: {} });
  await signOut(client);
  assert.deepEqual(client.calls, ['signOut']);
});

// ── error wording ──────────────────────────────────────────────────────────

test('the two errors a helper can act on are said in words', () => {
  assert.match(explain({ message: 'Invalid login credentials' }), /password is not right/);
  assert.match(explain({ message: 'TypeError: Failed to fetch' }), /No connection/);
  assert.match(explain({ message: 'Signups not allowed for this instance' }), /not set up yet/);
});

test('anything unrecognised is passed through rather than swallowed', () => {
  assert.equal(explain({ message: 'database is on fire' }), 'database is on fire');
  assert.equal(explain(null), 'unknown error');
});

// ── the gate is in the database, not in this code ──────────────────────────

test('no policy anywhere grants anon a privilege', async () => {
  // The whole arrangement rests on `anon` holding nothing. schema.sql is
  // documented as safe to re-run, so a policy naming anon that survives in it
  // would quietly reopen the catalog the next time it is pasted in.
  for (const file of ['schema.sql', 'migration-005-auth.sql']) {
    const sql = await readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8');
    const policies = sql.match(/create policy[\s\S]*?;/g) ?? [];
    assert.ok(policies.length > 0, `${file} should define policies`);
    for (const policy of policies) {
      assert.ok(!/\bto\s+[^;]*\banon\b/.test(policy), `${file} still grants anon:\n${policy}`);
    }
  }
});

test('the event log has no update or delete policy to be found', async () => {
  const sql = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const onEvents = (sql.match(/create policy[\s\S]*?;/g) ?? []).filter((p) => /on public\.events/.test(p));

  assert.equal(onEvents.length, 2, 'exactly select and insert');
  assert.ok(onEvents.some((p) => /for select/.test(p)));
  assert.ok(onEvents.some((p) => /for insert/.test(p)));
  assert.ok(!onEvents.some((p) => /for (update|delete|all)/.test(p)), 'history must not be editable');
});
