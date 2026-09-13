import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoundkeepClient, FoundkeepApiError } from './client.ts';
import { configureEnvironment } from '../environment.ts';

test('related-save requests stay private, coalesce, and refresh after edits or account changes', async () => {
  let token = 'first', reads = 0;
  const client = createFoundkeepClient({ getToken: async () => token, fetcher: async (input, init) => {
    assert.equal(new URL(String(input)).origin, 'https://foundkeep.app');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`);
    if (init?.method === 'PUT') return Response.json({ capture: { id: 'one' } });
    assert.equal(new URL(String(input)).pathname, '/api/mobile/captures/one/related');
    reads++; return Response.json({ items: [] });
  } });
  await Promise.all([client.relatedCaptures('one'), client.relatedCaptures('one')]);
  await client.relatedCaptures('one'); assert.equal(reads, 1);
  await client.updateCapture('one', { sourceTitle: null, noteText: null, expectedUpdatedAt: 1, userTags: ['New'] });
  await client.relatedCaptures('one'); assert.equal(reads, 2);
  token = 'second'; await client.relatedCaptures('one'); assert.equal(reads, 3);
});

test('long saved articles are decoded completely in collection and detail responses', async () => {
  const articleText = 'A saved paragraph with accents — café. '.repeat(5000);
  const capture = { id: 'long-article', type: 'bookmark', articleText, updatedAt: 123 };
  const client = createFoundkeepClient({
    getToken: async () => 'token',
    fetcher: async input => Response.json(String(input).endsWith('/long-article')
      ? { capture }
      : { captures: [capture], total: 1, nextCursor: null }),
  });
  assert.equal((await client.listCaptures({})).captures[0]?.articleText, articleText);
  assert.equal((await client.getCapture(capture.id)).capture.updatedAt, 123);
});

test('unreadable successful responses raise a recoverable API error instead of returning null', async () => {
  for (const body of ['{"captures":', 'null', '<html>upstream problem</html>']) {
    const client = createFoundkeepClient({
      getToken: async () => 'token',
      fetcher: async () => new Response(body, { status: 200 }),
    });
    await assert.rejects(client.listCaptures({}), (error: unknown) => {
      assert.ok(error instanceof FoundkeepApiError);
      assert.equal(error.code, 'invalid_response');
      assert.equal(error.message.includes(body), false);
      return true;
    });
  }
});

test('authenticated requests stay on the Foundkeep origin and encode collection filters', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ captures: [], total: 0, nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createFoundkeepClient({ getToken: async () => 'test-token', fetcher });
  await client.listCaptures({ q: 'small details', type: 'document', cursor: 'next_page' });
  assert.equal(calls[0]?.url, 'https://foundkeep.app/api/mobile/captures?view=cards&sort=recent&q=small+details&type=document&cursor=next_page');
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer test-token');
});

test('capture reads share requests and cache until explicitly refreshed or invalidated by a write', async () => {
  let reads = 0;
  const client = createFoundkeepClient({
    getToken: async () => 'token',
    fetcher: async (_url, init) => init?.method === 'POST'
      ? Response.json({ capture: { id: 'new' } })
      : Response.json({ captures: [{ id: String(++reads) }], total: 1, nextCursor: null }),
  });
  await Promise.all([client.listCaptures({}), client.listCaptures({})]);
  assert.equal(reads, 1);
  await client.listCaptures({});
  assert.equal(reads, 1);
  await client.listCaptures({}, { reload: true });
  assert.equal(reads, 2);
  await client.createNote({ clientId: 'new', noteText: 'A note', capturedAt: 1 });
  await client.listCaptures({});
  assert.equal(reads, 3);
});

test('capture caches never cross a changed or removed device credential', async () => {
  let token: string | null = 'account-one';
  let reads = 0;
  const client = createFoundkeepClient({
    getToken: async () => token,
    fetcher: async () => Response.json({ captures: [{ id: String(++reads) }], total: 1, nextCursor: null }),
  });
  assert.equal((await client.listCaptures({})).captures[0]?.id, '1');
  token = 'account-two';
  assert.equal((await client.listCaptures({})).captures[0]?.id, '2');
  token = null;
  await assert.rejects(client.listCaptures({}), (error: unknown) => error instanceof FoundkeepApiError && error.status === 401);
});

test('a read started before a mutation cannot repopulate the cache with stale data', async () => {
  let release!: (value: Response) => void;
  let reads = 0;
  const client = createFoundkeepClient({
    getToken: async () => 'token',
    fetcher: async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ capture: { id: 'new' } });
      if (++reads === 1) return new Promise<Response>(resolve => { release = resolve; });
      return Response.json({ captures: [{ id: 'new' }], total: 1, nextCursor: null });
    },
  });
  const oldRead = client.listCaptures({});
  await new Promise(resolve => setImmediate(resolve));
  await client.createNote({ clientId: 'new', noteText: 'New note', capturedAt: 1 });
  release(Response.json({ captures: [], total: 0, nextCursor: null }));
  await oldRead;
  assert.equal((await client.listCaptures({})).captures[0]?.id, 'new');
});

test('failed reads are retried, and the capture cache evicts older entries', async () => {
  let reads = 0;
  const client = createFoundkeepClient({
    getToken: async () => 'token',
    fetcher: async () => ++reads === 1 ? new Response('offline', { status: 503 }) : Response.json({ capture: { id: String(reads) } }),
  });
  await assert.rejects(client.getCapture('first'));
  await client.getCapture('first');
  assert.equal(reads, 2);
  await client.getCapture('first');
  assert.equal(reads, 2);
  for (let i = 0; i < 21; i++) await client.getCapture(String(i));
  const before = reads;
  await client.getCapture('first');
  assert.equal(reads, before + 1);
});

test('expired captures are fetched again without requiring a screen restart', async t => {
  let now = 100_000, reads = 0;
  t.mock.method(Date, 'now', () => now);
  const client = createFoundkeepClient({ getToken: async () => 'token', fetcher: async () => Response.json({ capture: { id: String(++reads) } }) });
  await client.getCapture('a');
  now += 19_000;
  await client.getCapture('a');
  assert.equal(reads, 1);
  now += 2_000;
  await client.getCapture('a');
  assert.equal(reads, 2);
});

test('very large responses remain readable without being retained in the memory cache', async () => {
  let reads = 0;
  const text = 'x'.repeat(3 * 1024 * 1024);
  const client = createFoundkeepClient({
    getToken: async () => 'token',
    fetcher: async () => { reads++; return Response.json({ capture: { articleText: text } }); },
  });
  assert.equal((await client.getCapture('large')).capture.articleText?.length, text.length);
  await client.getCapture('large');
  assert.equal(reads, 2);
});

test('public registration omits authorization and returns the native device session', async () => {
  let headers = new Headers();
  let requestBody: any;
  const client = createFoundkeepClient({
    getToken: async () => 'must-not-leak',
    fetcher: async (_input, init) => {
      headers = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ account: { id: 'a', email: 'a@example.com', name: 'A', createdAt: 1 }, token: 't', recoveryCode: 'r', connection: { id: 'c', name: 'Foundkeep for iPhone', createdAt: 1, lastSeenAt: null } }), { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await client.register({ email: 'a@example.com', name: 'A', password: 'long password', deviceName: "Pritam's iPhone" });
  assert.equal(headers.get('authorization'), null);
  assert.equal(requestBody.deviceName, "Pritam's iPhone");
  assert.equal(result.token, 't');
});

test('API errors expose bounded customer copy without retaining response bodies', async () => {
  const client = createFoundkeepClient({
    getToken: async () => 'token',
    fetcher: async () => new Response(JSON.stringify({ error: 'quota_exceeded', message: 'x'.repeat(1000) }), { status: 409, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(client.listCaptures({}), (error: unknown) => {
    assert.ok(error instanceof FoundkeepApiError);
    const apiError = error as FoundkeepApiError;
    assert.equal(apiError.status, 409);
    assert.equal(apiError.code, 'quota_exceeded');
    assert.equal(apiError.message.length, 300);
    return true;
  });
});

test('account deletion uses the authenticated mobile endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createFoundkeepClient({
    getToken: async () => 'delete-token',
    fetcher: async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ ok: true }); },
  });
  await client.deleteAccount('correct password');
  assert.equal(calls[0]?.url, 'https://foundkeep.app/api/mobile/account');
  assert.equal(calls[0]?.init?.method, 'DELETE');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { password: 'correct password' });
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer delete-token');
});

test('notification registration and removal use the current mobile connection', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createFoundkeepClient({
    getToken: async () => 'device-token',
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(String(url).endsWith('/notifications') && init?.method === 'GET' ? { enabled: false } : { ok: true });
    },
  });
  assert.deepEqual(await client.notificationStatus(), { enabled: false });
  await client.registerNotifications('ExpoPushToken[abc_DEF-0123456789]');
  await client.unregisterNotifications();
  assert.deepEqual(calls.map(call => [call.url, call.init?.method]), [
    ['https://foundkeep.app/api/mobile/notifications', 'GET'],
    ['https://foundkeep.app/api/mobile/notifications', 'POST'],
    ['https://foundkeep.app/api/mobile/notifications', 'DELETE'],
  ]);
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { expoPushToken: 'ExpoPushToken[abc_DEF-0123456789]' });
});

test('organization filters and personal edits remain authenticated and invalidate organization counts', async () => {
  const requests: Array<{ url: URL; method: string; body: any }> = [];
  let reads = 0;
  const client = createFoundkeepClient({ getToken: async () => 'private-device', fetcher: async (input, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-device');
    const url = new URL(String(input)); assert.equal(url.origin, 'https://foundkeep.app');
    requests.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === '/api/mobile/organization') { reads++; return Response.json({ folders: [], tags: [], suggestedTags: [], suggestedFolders: [] }); }
    return Response.json({ capture: { id: 'item' }, captures: [], nextCursor: null, total: 0 });
  } });
  await client.organization(); await client.organization(); assert.equal(reads, 1);
  await client.listCaptures({ folderId: 'unfiled', tag: 'Ideas & Work', batchId: 'batch-1' });
  const query = requests.at(-1)!.url.searchParams;
  assert.equal(query.get('tag'), 'Ideas & Work'); assert.equal(query.get('folderId'), 'unfiled'); assert.equal(query.get('batchId'), 'batch-1');
  await client.updateCapture('item', { sourceTitle: 'Mine', noteText: null, expectedUpdatedAt: 12, folderId: null, userTags: ['Ideas & Work'] });
  assert.deepEqual(requests.at(-1)!.body, { sourceTitle: 'Mine', noteText: null, expectedUpdatedAt: 12, folderId: null, userTags: ['Ideas & Work'] });
  assert.equal(requests.at(-1)!.method, 'PUT');
  await client.organization(); assert.equal(reads, 2);
  await client.createNote({ clientId: 'new', capturedAt: 13, noteText: 'Keep this', folderId: 'reading', userTags: ['Personal'] });
  assert.equal(requests.at(-1)!.body.folderId, 'reading'); assert.deepEqual(requests.at(-1)!.body.userTags, ['Personal']);
});

test('native notes record their actual app platform without trusting caller input',async()=>{
 const bodies:Record<string,unknown>[]=[];
 const client=createFoundkeepClient({getToken:async()=> 'token',fetcher:async(_input,init)=>{bodies.push(JSON.parse(String(init?.body)));return Response.json({capture:{id:'note'}});}});
 try {
  configureEnvironment(undefined,'android');await client.createNote({clientId:'android-note',noteText:'Android',capturedAt:1000});
  configureEnvironment(undefined,'ios');await client.createNote({clientId:'ios-note',noteText:'iOS',capturedAt:2000});
 } finally { configureEnvironment(undefined,'ios'); }
 assert.equal((bodies[0]?.provenance as Record<string,unknown>).captureMethod,'android-app-note');
 assert.equal((bodies[1]?.provenance as Record<string,unknown>).captureMethod,'ios-app-note');
});

test('social auth uses only Foundkeep endpoints and separates login from authenticated deletion', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = createFoundkeepClient({ getToken: async () => 'device-token', fetcher: async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ providers: ['apple'] }); } });
  await client.oauthProviders();
  await client.startOAuth({ provider: 'google', intent: 'sign-in', codeChallenge: 'challenge' });
  await client.exchangeOAuth({ flow: 'flow', code: 'handoff', verifier: 'verifier' }, 'sign-in');
  await client.startOAuth({ provider: 'apple', intent: 'delete', codeChallenge: 'challenge' });
  await client.exchangeOAuth({ flow: 'flow', code: 'handoff', verifier: 'verifier' }, 'delete');
  await client.deleteAccount({ reauthToken: 'one-use-proof' });
  for (const call of calls) assert.equal(new URL(call.url).origin, 'https://foundkeep.app');
  for (const call of calls.slice(0,3)) assert.equal(new Headers(call.init?.headers).has('authorization'), false);
  for (const call of calls.slice(3)) assert.equal(new Headers(call.init?.headers).get('authorization'), 'Bearer device-token');
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), { reauthToken: 'one-use-proof' });
});
