import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { signObject, digest, base64, type SignedIssue } from './protocol';
import { GitHub } from './github';

function reader(fixtures: SignedIssue[], tamper = false) {
  return new GitHub('a/b', '', async url => {
    const path = new URL(String(url)).pathname;
    let data: unknown;
    if (path.includes('matching-refs')) data = fixtures.map((fixture, i) => ({ ref: `refs/hn/actors/${fixture.actor}`, object: { type: 'commit', sha: String(i) } }));
    else if (path.includes('/commits/')) data = { tree: { sha: path.split('/').at(-1) }, parents: [] };
    else if (path.includes('/trees/')) {
      const i = path.split('/').at(-1);
      data = { tree: [{ path: 'event.json', type: 'blob', sha: `${i}-event` }, { path: 'signature', type: 'blob', sha: `${i}-signature` }] };
    } else {
      const [index, kind] = path.split('/').at(-1)!.split('-');
      const fixture = fixtures[Number(index)];
      const content = kind === 'event' ? fixture.payload + (tamper ? ' ' : '') : fixture.signature;
      data = { content: Buffer.from(content).toString('base64'), encoding: 'base64', size: Buffer.byteLength(content) };
    }
    return new Response(JSON.stringify(data));
  });
}
test('repo summary counts object openings once and includes later non-opening events in latest change', async () => {
  const issue = await signObject('issue', 'Tester', { title: 'Issue', body: '' });
  const project = await signObject('project', 'Tester', { title: 'Project', body: '' });
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = ed25519.getPublicKey(secret);
  const actor = await digest(publicKey);
  const payload = JSON.stringify({ protocol: 'hn/0', kind: 'issue.comment', actor, actorName: 'Commenter', publicKey: base64(publicKey), sequence: 1, timestamp: '2030-01-01T00:00:00Z', subject: issue.id, body: 'Later activity' });
  const bytes = new TextEncoder().encode(payload);
  const comment = { payload, actor, signature: base64(ed25519.sign(bytes, secret)), id: `sha256:${await digest(bytes)}` };
  const client = reader([issue, project, comment]);
  const summary = await client.summarizeObjects();
  assert.equal(summary.total, 2);
  assert.equal(summary.counts.issue, 1);
  assert.equal(summary.counts.project, 1);
  assert.equal(summary.eventCount, 3);
  assert.equal(summary.lastChanged, '2030-01-01T00:00:00Z');
  assert.equal((await client.listObjects('issue')).length, 1);
  await assert.rejects(reader([issue], true).summarizeObjects(), /Invalid actor event or signature/);
});
test('repo without actor histories has zero counts and no latest date', async () => {
  const summary = await reader([]).summarizeObjects();
  assert.equal(summary.total, 0);
  assert.equal(summary.lastChanged, null);
  assert.equal(summary.eventCount, 0);
});
