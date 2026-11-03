import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, signIssue, digest } from './protocol';
import { GitHub } from './github';

test('repository selection accepts GitHub URLs and rejects injected paths', () => {
  assert.equal(parseRepo('https://github.com/exergy-connect/hubnot.git/'), 'exergy-connect/hubnot');
  for (const invalid of ['https://evil.test/a/b', 'owner/repo/issues', 'a/b?token=secret', 'a/..', '']) {
    assert.throws(() => parseRepo(invalid));
  }
});
test('native issue signature authenticates exact UTF-8 bytes and fresh actor', async () => {
  const issue = await signIssue('Browser tester', 'Unicode 🐈 <title>', 'Line 1\nLine 2');
  const event = JSON.parse(issue.payload);
  const bytes = new TextEncoder().encode(issue.payload);
  const raw = Uint8Array.from(atob(event.publicKey), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, 'Ed25519', true, ['verify']);
  assert.equal(await crypto.subtle.verify('Ed25519', key, Uint8Array.from(atob(issue.signature), c => c.charCodeAt(0)), bytes), true);
  assert.equal(issue.id, `sha256:${await digest(bytes)}`);
  assert.equal(issue.actor, await digest(raw));
  assert.equal(event.sequence, 1);
  assert.equal(event.previous, undefined);
  assert.notEqual((await signIssue('Tester', 'Next', '')).actor, issue.actor);
  await assert.rejects(signIssue('Tester', '🐈'.repeat(257), ''));
  await assert.rejects(signIssue('Tester', 'Title', 'x'.repeat(65537)));
});
test('Git trees contain exact signed payload and raw base64 signature; commit is a root', async () => {
  const issue = await signIssue('Tester', 'Title', '');
  const calls: { path: string; data: any }[] = [];
  const client = new GitHub('a/b', 'secret', async (url, init) => {
    calls.push({ path: String(url), data: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ sha: calls.length === 1 ? 'tree' : 'commit' }));
  });
  assert.equal(await client.prepare(issue), 'commit');
  assert.deepEqual(calls[0].data.tree.map((entry: any) => [entry.path, entry.content]), [['event.json', issue.payload], ['signature', issue.signature]]);
  assert.deepEqual(calls[1].data.parents, []);
  assert.equal(calls[0].data.base_tree, undefined);
});
test('uncertain create reconciles exact commit and never forces a reference', async () => {
  const issue = await signIssue('Tester', 'Title', '');
  let calls = 0;
  const client = new GitHub('a/b', 'secret', async (_url, init) => {
    calls++;
    if (init?.method === 'POST') throw new Error('timeout');
    return new Response(JSON.stringify({ object: { sha: 'commit' } }));
  });
  await client.publish(issue, 'commit');
  assert.equal(calls, 2);
  await assert.rejects(client.publish(issue, 'different'), /timeout/);
});
test('permission and empty repository failures surface without publishing', async () => {
  const denied = new GitHub('a/b', 'secret', async () => new Response('{"message":"Forbidden"}', { status: 403 }));
  await assert.rejects(denied.inspect(), /403: Forbidden/);
  const empty = new GitHub('a/b', '', async url => new Response(JSON.stringify(String(url).includes('/branches') ? [] : { full_name: 'a/b' })));
  await assert.rejects(empty.inspect(), /Initialize/);
});
