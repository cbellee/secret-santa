import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, errorHandler } from './app.ts';
import type { AppConfig } from './app.ts';
import { Store } from './store.ts';
import type { Member } from './domain.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const config: AppConfig = {
  origin: 'http://santa.test', production: false, inviteCode: 'a-private-group-code',
  google: { clientId: 'test-google', clientSecret: 'test-secret' },
  facebook: { clientId: 'test-facebook', clientSecret: 'test-secret' }, facebookVersion: 'v24.0',
};
async function harness(t: TestContext, overrides: Partial<AppConfig> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'santa-test-'));
  const path = join(directory, 'test.sqlite');
  const store = new Store(path);
  const app = createApp({ ...config, ...overrides }, store);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.db.close();
    rmSync(directory, { recursive: true });
  });
  const url = `http://127.0.0.1:${address.port}`;
  function login(providerId: string, member = true) {
    const id = store.findOrCreateUser('google', providerId);
    if (member) store.join(id, providerId);
    const session = `session-${providerId}`;
    store.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(session), id, Date.now() + 60_000);
    return { id, cookie: `santa=${session}` };
  }
  return { store, path, url, login };
}
async function request(url: string, path: string, method = 'GET', body?: unknown, cookie = '', origin = config.origin) {
  return fetch(`${url}/api/${path}`, {
    method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('group data requires OAuth session plus invitation; CSRF and invalid invitations are rejected', async t => {
  const { url, login } = await harness(t);
  assert.equal((await request(url, 'members')).status, 401);
  assert.equal((await request(url, 'wishlist', 'PUT', [])).status, 401);
  const pending = login('New member', false);
  assert.equal((await request(url, 'members', 'GET', undefined, pending.cookie)).status, 403);
  assert.equal((await request(url, 'profile', 'PUT', { shortName: 'Chris', inviteCode: config.inviteCode }, pending.cookie, 'https://evil.example')).status, 403);
  assert.equal((await request(url, 'profile', 'PUT', { shortName: 'Chris', inviteCode: 'wrong' }, pending.cookie)).status, 403);
  assert.equal((await request(url, 'profile', 'PUT', { shortName: 'Chris', inviteCode: config.inviteCode }, pending.cookie)).status, 200);
  assert.equal((await request(url, 'members', 'GET', undefined, pending.cookie)).status, 200);
});

test('persist ranked gifts, enforce limits server-side, isolate edits and revoke logout sessions', async t => {
  const { url, store, path, login } = await harness(t);
  const alice = login('Alice');
  const bob = login('Bob');
  const gifts = [
    { url: 'https://shop.example/second', priceCents: 5000, description: 'My first choice', giftCard: false },
    { url: '', priceCents: 4999, description: 'Bunnings', giftCard: true },
  ];
  assert.equal((await request(url, 'wishlist', 'PUT', gifts, alice.cookie)).status, 200);
  for (const invalid of [[{ ...gifts[0], priceCents: 5001 }], [gifts[0], gifts[0]], [...gifts, ...gifts]]) {
    assert.equal((await request(url, 'wishlist', 'PUT', invalid, alice.cookie)).status, 400);
  }
  const reopened = new Store(path);
  try { assert.deepEqual(reopened.getUser(alice.id)?.gifts, gifts); }
  finally { reopened.db.close(); }
  assert.deepEqual(store.getUser(bob.id)?.gifts, []);
  const response = await request(url, 'members', 'GET', undefined, bob.cookie);
  const data = await response.json() as { members: Member[] };
  assert.deepEqual(data.members.find(member => member.id === alice.id)?.gifts, gifts);
  assert.equal((await request(url, 'wishlist', 'PUT', [], alice.cookie)).status, 200);
  assert.deepEqual(store.getUser(alice.id)?.gifts, []);
  assert.equal((await request(url, 'logout', 'POST', undefined, bob.cookie)).status, 200);
  assert.equal((await request(url, 'members', 'GET', undefined, bob.cookie)).status, 401);
});

test('OAuth state is browser-bound and one-time; valid provider identity issues secure session', async t => {
  const { url, store } = await harness(t, { production: true, origin: 'https://santa.test' });
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const endpoint = String(input);
    if (endpoint.startsWith('https://oauth2.googleapis.com/')) {
      seen.push(endpoint);
      assert.match(String(init?.body), /code_verifier=/);
      return Response.json({ access_token: 'provider-token' });
    }
    if (endpoint.startsWith('https://openidconnect.googleapis.com/')) {
      seen.push(endpoint);
      return Response.json({ sub: 'provider-123' });
    }
    return realFetch(input, init);
  });
  const start = await fetch(`${url}/auth/google`, { redirect: 'manual' });
  const location = new URL(start.headers.get('location')!);
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  const browserCookie = start.headers.getSetCookie()[0]!.split(';')[0]!;
  const state = location.searchParams.get('state')!;
  const callback = `${url}/auth/google/callback?state=${state}&code=provider-code`;
  assert.equal((await fetch(callback, { redirect: 'manual' })).status, 400);
  const success = await fetch(callback, { headers: { Cookie: browserCookie }, redirect: 'manual' });
  assert.equal(success.status, 302);
  const sessionCookie = success.headers.getSetCookie().find(value => value.startsWith('__Host-santa='))!;
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Secure/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.equal(seen.length, 2);
  assert.equal((await fetch(callback, { headers: { Cookie: browserCookie }, redirect: 'manual' })).status, 400);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count, 1);
});

test('OAuth rejects expired state and does not create sessions on provider failure', async t => {
  const { url, store } = await harness(t);
  const first = await fetch(`${url}/auth/facebook`, { redirect: 'manual' });
  const state = new URL(first.headers.get('location')!).searchParams.get('state')!;
  const browserCookie = first.headers.getSetCookie()[0]!.split(';')[0]!;
  store.db.prepare('UPDATE oauth_states SET expires = 0').run();
  assert.equal((await fetch(`${url}/auth/facebook/callback?state=${state}&code=x`, { headers: { Cookie: browserCookie }, redirect: 'manual' })).status, 400);
  const second = await fetch(`${url}/auth/google`, { redirect: 'manual' });
  const secondState = new URL(second.headers.get('location')!).searchParams.get('state')!;
  const secondCookie = second.headers.getSetCookie()[0]!.split(';')[0]!;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    return String(input).startsWith('https://oauth2.googleapis.com')
      ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : realFetch(input, init);
  });
  const failed = await fetch(`${url}/auth/google/callback?state=${secondState}&code=x`, { headers: { Cookie: secondCookie }, redirect: 'manual' });
  assert.equal(failed.headers.get('location'), '/?authError=failed');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM sessions').get()?.count, 0);
});

test('Facebook sign-in uses app-secret proof and accepts its app-scoped identity without email', async t => {
  const { url, store } = await harness(t);
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname !== 'graph.facebook.com') return realFetch(input, init);
    if (endpoint.pathname.endsWith('/oauth/access_token')) {
      assert.equal(init?.method, 'POST');
      assert.equal(new URLSearchParams(String(init?.body)).get('client_id'), config.facebook.clientId);
      return Response.json({ access_token: 'facebook-access-token' });
    }
    assert.equal(endpoint.pathname, '/v24.0/me');
    assert.equal(endpoint.searchParams.get('fields'), 'id');
    assert.equal(endpoint.searchParams.get('appsecret_proof'),
      createHmac('sha256', config.facebook.clientSecret).update('facebook-access-token').digest('hex'));
    return Response.json({ id: 'facebook-user-123' });
  });
  const start = await fetch(`${url}/auth/facebook`, { redirect: 'manual' });
  const location = new URL(start.headers.get('location')!);
  assert.equal(location.origin, 'https://www.facebook.com');
  const state = location.searchParams.get('state')!;
  const browserCookie = start.headers.getSetCookie()[0]!.split(';')[0]!;
  const success = await fetch(`${url}/auth/facebook/callback?state=${state}&code=facebook-code`, {
    headers: { Cookie: browserCookie }, redirect: 'manual',
  });
  assert.equal(success.status, 302);
  const sessionCookie = success.headers.getSetCookie().find(value => value.startsWith('santa='))!.split(';')[0]!;
  const sessionResponse = await request(url, 'session', 'GET', undefined, sessionCookie);
  const session = await sessionResponse.json() as { user: { member: boolean } };
  assert.equal(session.user.member, false);
  assert.equal(store.db.prepare('SELECT provider FROM users').get()?.provider, 'facebook');
});

test('duplicate member names are rejected, but renaming yourself to a different case is allowed', async t => {
  const { url, login } = await harness(t);
  const alice = login('Alice');
  const newcomer = login('Newcomer', false);
  const join = (shortName: string, cookie: string) => request(url, 'profile', 'PUT', { shortName, inviteCode: config.inviteCode }, cookie);
  assert.equal((await join('ALICE', newcomer.cookie)).status, 409);
  assert.equal((await join('Ａｌｉｃｅ', newcomer.cookie)).status, 409);
  assert.equal((await join('Ali\u200Bce', newcomer.cookie)).status, 400);
  assert.equal((await join('Alicia', newcomer.cookie)).status, 200);
  assert.equal((await join('alice', alice.cookie)).status, 200);
  assert.equal((await join('Alicia', alice.cookie)).status, 409);
});

test('wrong invite codes are limited per account, independent of IP', async t => {
  const { url, login } = await harness(t);
  const guesser = login('Guesser', false);
  const other = login('Other', false);
  for (let i = 0; i < 10; i++) {
    assert.equal((await request(url, 'profile', 'PUT', { shortName: 'Guesser', inviteCode: `wrong-${i}` }, guesser.cookie)).status, 403);
  }
  assert.equal((await request(url, 'profile', 'PUT', { shortName: 'Guesser', inviteCode: config.inviteCode }, guesser.cookie)).status, 429);
  assert.equal((await request(url, 'profile', 'PUT', { shortName: 'Other', inviteCode: config.inviteCode }, other.cookie)).status, 200);
});

test('wishlists saved before gift cards existed still load, as non-gift-card gifts', async t => {
  const { store, login } = await harness(t);
  const alice = login('Alice');
  store.db.prepare('UPDATE users SET gifts = ? WHERE id = ?')
    .run(JSON.stringify([{ url: 'https://shop.example/old', priceCents: 1000, description: '' }]), alice.id);
  assert.deepEqual(store.getUser(alice.id)?.gifts, [{ url: 'https://shop.example/old', priceCents: 1000, description: '', giftCard: false }]);
});

test('PRIVACY.md on GitHub repeats every paragraph of the served privacy and deletion pages', async () => {
  const { readFile } = await import('node:fs/promises');
  const { infoPage } = await import('./pages.ts');
  const markdown = (await readFile(new URL('../PRIVACY.md', import.meta.url), 'utf8')).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  for (const kind of ['privacy', 'deletion'] as const) {
    const paragraphs = [...infoPage(kind).matchAll(/<p>([\s\S]*?)<\/p>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ''));
    assert.ok(paragraphs.length > 0);
    for (const paragraph of paragraphs) assert.ok(markdown.includes(paragraph), `PRIVACY.md is missing: ${paragraph.slice(0, 60)}...`);
  }
});

test('privacy and data-deletion pages are complete HTML that crawlers can read without JavaScript', async t => {
  const { url } = await harness(t);
  for (const [path, phrase] of [['/privacy', 'What this site stores'], ['/data-deletion', 'Remove your profile and wishlist']] as const) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.match(html, new RegExp(phrase));
    assert.doesNotMatch(html, /<script/i);
  }
});

test('account deletion removes wishes and all sessions without affecting other members', async t => {
  const { url, store, login } = await harness(t);
  const alice = login('Alice');
  const bob = login('Bob');
  store.saveGifts(alice.id, [{ url: 'https://shop.example/gift', priceCents: 5000, description: '', giftCard: false }]);
  store.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest('another-alice-session'), alice.id, Date.now() + 60_000);
  assert.equal((await request(url, 'account', 'DELETE', undefined, alice.cookie, 'https://evil.example')).status, 403);
  assert.equal((await request(url, 'account', 'DELETE', undefined, alice.cookie)).status, 200);
  assert.equal(store.getUser(alice.id), null);
  assert.equal((await request(url, 'members', 'GET', undefined, 'santa=another-alice-session')).status, 401);
  assert.equal((await request(url, 'members', 'GET', undefined, bob.cookie)).status, 200);
  assert.equal(store.members().length, 1);
});
