import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectTypes, openingFields, displayOpening } from './objects';
import { signObject } from './protocol';
import { verifyActorEvent } from './issues';

test('all selectable object types produce authenticated native openings and display content', async () => {
  for (const type of Object.keys(objectTypes) as (keyof typeof objectTypes)[]) {
    const input = { title: 'Test title', body: 'Test body', category: 'general', workflowName: 'check', parent: `sha256:${'a'.repeat(64)}`, revision: `sha256:${'a'.repeat(64)}` };
    const signed = await signObject(type, 'Tester', input);
    const { event } = await verifyActorEvent(new TextEncoder().encode(signed.payload), Buffer.from(signed.signature, 'base64'), signed.actor);
    assert.equal(event.kind, `${type}.open`);
    assert.equal(displayOpening(type, event.title, event.body).body, 'Test body');
    if (type !== 'issue') {
      assert.equal((event as any).intent, 'open');
      assert.equal(event.title, undefined);
    }
  }
});
test('linked and named objects reject missing or invalid required fields', () => {
  const input = { title: 'Title', body: 'Body' };
  for (const type of ['project-item', 'discussion-reply', 'discussion', 'workflow'] as const) assert.throws(() => openingFields(type, input));
  assert.throws(() => openingFields('workflow', { ...input, workflowName: 'x'.repeat(65) }));
});
