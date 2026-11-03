import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserCLI, splitCommand } from './cli';
import { GitHub } from './github';
import type { SignedIssue } from './protocol';

const context = { repo: 'owner/repo', token: 'secret-token', author: 'Tester' };
class FakeGitHub extends GitHub {
  creations: SignedIssue[] = [];
  attempts = 0;
  fail = false;
  override async inspect() { return { full_name: this.repo, description: '', size: 1, permissions: { push: true } }; }
  override async listObjects() { return [{ id: `sha256:${'a'.repeat(64)}`, title: 'Existing', body: 'Body', author: 'Tester', timestamp: '2026-01-01T00:00:00Z' }]; }
  override async prepare(issue: SignedIssue) { this.creations.push(issue); return 'b'.repeat(40); }
  override async publish() { this.attempts++; if (this.fail) throw new Error('Network timeout'); }
}
test('console parses quoted arguments without executing shell syntax', () => {
  assert.deepEqual(splitCommand(`hn issue open --body 'A body with "quotes"' "A title"`), ['hn', 'issue', 'open', '--body', 'A body with "quotes"', 'A title']);
  assert.deepEqual(splitCommand('hn issue open ""'), ['hn', 'issue', 'open', '']);
  for (const text of ['hn issue list | cat', 'hn issue list; ls', 'hn issue open $(whoami)', 'hn "unfinished']) assert.throws(() => splitCommand(text));
});
test('console commands use selected repo, reject unsupported operations and keep secrets out of output', async () => {
  const client = new FakeGitHub(context.repo, context.token);
  const cli = new BrowserCLI((repo, token) => { assert.equal(repo, context.repo); assert.equal(token, context.token); return client; });
  assert.match(await cli.run('hn help', context), /hn issue open/);
  assert.match(await cli.run('hn issue list', context), /Existing/);
  assert.equal(JSON.parse(await cli.run('hn issue show aaaaaaaa --json', context)).title, 'Existing');
  for (const command of ['git status', 'hn issue close aaaaaaaa', 'hn proposal open title', 'hn issue open --force title']) await assert.rejects(cli.run(command, context));
  assert.equal(client.creations.length, 0);
  const output = await cli.run('hn issue open --body "Description" "Title"', context);
  assert.match(output, /Published sha256:/);
  assert.ok(!output.includes(context.token));
  assert.equal(JSON.parse(client.creations[0].payload).title, 'Title');
});
test('console retries same signed object and commit and blocks duplicate or wrong-repo publication', async () => {
  const client = new FakeGitHub(context.repo, context.token);
  const cli = new BrowserCLI(() => client);
  client.fail = true;
  await assert.rejects(cli.run('hn issue open Title', context), /hn retry/);
  await assert.rejects(cli.run('hn issue open Another', context), /pending/);
  await assert.rejects(cli.run('hn retry', { ...context, repo: 'other/repo' }), /Select owner\/repo/);
  client.fail = false;
  assert.match(await cli.run('hn retry', context), /Published/);
  assert.equal(client.creations.length, 1);
  assert.equal(client.attempts, 2);
  assert.equal(cli.hasPending, false);
});
test('resource input cannot silently lose unsupported state', async () => {
  const client = new FakeGitHub(context.repo, context.token);
  const cli = new BrowserCLI(() => client);
  await cli.run(`hn project open --input '{"schema":"hn.project/1","title":"Roadmap","body":"Planning","archived":false}'`, context);
  assert.equal(JSON.parse(client.creations[0].payload).kind, 'project.open');
  await assert.rejects(cli.run(`hn project open --input '{"schema":"hn.project/1","title":"Hidden","archived":true}'`, context), /unsupported fields/);
  await assert.rejects(cli.run('hn project open --input project.json', context));
});
