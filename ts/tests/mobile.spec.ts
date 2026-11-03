import { test, expect } from '@playwright/test';
import { ed25519 } from '@noble/curves/ed25519.js';

test('mobile publishes a verifiable native issue without native Ed25519 or AbortSignal.timeout', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto.subtle, 'generateKey', { value: () => { throw new Error('Native Ed25519 unavailable'); } });
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined });
  });
  const writes: { path: string; data: any }[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') writes.push({ path, data: request.postDataJSON() });
    const data = path.endsWith('/branches') ? [{ name: 'main' }]
      : path.endsWith('/git/trees') ? { sha: 'a'.repeat(40) }
      : path.endsWith('/git/commits') ? { sha: 'b'.repeat(40) }
      : path.endsWith('/git/refs') ? { ref: 'ok' }
      : { full_name: 'exergy-connect/hubnot', permissions: { push: true } };
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#token').fill('test-token');
  await page.locator('#inspect').tap();
  await expect(page.locator('#repo-status')).toContainText('Write access available');
  await page.locator('#name').fill('Mobile tester');
  await page.locator('#title').fill('An issue from a phone 🐈');
  await page.locator('#body').fill('Exact bytes: <>&\nSecond line');
  await page.locator('#submit').tap();
  await expect(page.locator('#status')).toContainText('Published.');
  expect(writes).toHaveLength(3);
  const tree = writes[0].data.tree;
  const payload = tree.find((entry: any) => entry.path === 'event.json').content;
  const signature = tree.find((entry: any) => entry.path === 'signature').content;
  expect(ed25519.verify(Buffer.from(signature, 'base64'), new TextEncoder().encode(payload), Buffer.from(JSON.parse(payload).publicKey, 'base64'))).toBe(true);
  expect(writes[2].data.ref).toBe(`refs/hn/actors/${JSON.parse(payload).actor}`);
  await expect(page.locator('#token')).toHaveValue('');
  await page.locator('#another').tap();
  await expect(page.locator('#title')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('tokens are opt-in, scoped to canonical repository, restored and removable', async ({ page }) => {
  await page.goto('/');
  const token = page.locator('#token');
  const remember = page.locator('#remember-token');
  const repo = page.locator('#repo');
  await expect(remember).not.toBeChecked();
  await token.fill('unsaved-token');
  await page.reload();
  await expect(token).toHaveValue('');
  await token.fill('repo-one-token');
  await remember.check();
  await page.reload();
  await expect(token).toHaveValue('repo-one-token');
  await expect(remember).toBeChecked();
  await repo.fill('other/project');
  await expect(token).toHaveValue('');
  await expect(remember).not.toBeChecked();
  await token.fill('repo-two-token');
  await remember.check();
  await repo.fill('https://github.com/EXERGY-CONNECT/HUBNOT.git');
  await expect(token).toHaveValue('repo-one-token');
  await remember.uncheck();
  await page.reload();
  await expect(token).toHaveValue('');
  await expect(remember).not.toBeChecked();
  await repo.fill('other/project');
  await expect(token).toHaveValue('repo-two-token');
});

test('blocked storage leaves token usable in memory', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  await page.goto('/');
  await page.locator('#token').fill('memory-token');
  await page.locator('#remember-token').click();
  await expect(page.locator('#remember-token')).not.toBeChecked();
  await expect(page.locator('#token')).toHaveValue('memory-token');
  await expect(page.locator('#storage-status')).toContainText('storage is unavailable');
});

test('existing issues tab reads signed native openings, safely renders text and preserves drafts', async ({ page }) => {
  const { signIssue } = await import('../src/protocol');
  const opening = await signIssue('Reader tester', '<img src=x onerror=alert(1)>', 'Original issue body');
  let tampered = false;
  await page.route('https://api.github.com/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path.includes('/other/project/')) data = [];
    else if (path.endsWith('/git/matching-refs/hn/actors/')) data = [{ ref: `refs/hn/actors/${opening.actor}`, object: { type: 'commit', sha: 'a'.repeat(40) } }];
    else if (path.includes('/git/commits/')) data = { tree: { sha: 'b'.repeat(40) }, parents: [] };
    else if (path.includes('/git/trees/')) data = { tree: [{ path: 'event.json', type: 'blob', sha: 'c'.repeat(40) }, { path: 'signature', type: 'blob', sha: 'd'.repeat(40) }] };
    else {
      const content = path.endsWith('c'.repeat(40)) ? (tampered ? opening.payload.replace('Original', 'Tampered') : opening.payload) : opening.signature;
      data = { content: Buffer.from(content).toString('base64'), encoding: 'base64', size: Buffer.byteLength(content) };
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.locator('#title').fill('Keep this draft');
  await page.getByRole('tab', { name: 'Existing issues' }).tap();
  await expect(page.locator('#issues-status')).toHaveText('1 signed issue opening.');
  await expect(page.locator('.issue-card h2')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.issue-card img')).toHaveCount(0);
  await expect(page.locator('.issue-body')).toHaveText('Original issue body');
  await page.getByRole('tab', { name: 'New signed issue' }).tap();
  await expect(page.locator('#title')).toHaveValue('Keep this draft');
  await page.locator('#new-tab').press('ArrowLeft');
  await expect(page.locator('#existing-tab')).toBeFocused();
  await expect(page.locator('#issues-status')).toHaveText('1 signed issue opening.');
  tampered = true;
  await page.locator('#refresh-issues').tap();
  await expect(page.locator('#issues-status')).toContainText('Invalid actor event or signature');
  await expect(page.locator('.issue-card')).toHaveCount(0);
  await page.locator('#repo').fill('other/project');
  await page.locator('#refresh-issues').tap();
  await expect(page.locator('#issues-status')).toContainText('No native Hubnot issues');
});

test('object selector scopes tabs, preserves drafts and publishes each resource type', async ({ page }) => {
  const { signObject } = await import('../src/protocol');
  const parents = [await signObject('project', 'Parent author', { title: 'Parent project', body: '' }), await signObject('discussion', 'Parent author', { title: 'Parent discussion', body: '', category: 'general' })];
  let published: any;
  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = { full_name: 'exergy-connect/hubnot', permissions: { push: true } };
    if (path.endsWith('/branches')) data = [{ name: 'main' }];
    if (path.endsWith('/git/matching-refs/hn/actors/')) data = parents.map((parent, index) => ({ ref: `refs/hn/actors/${parent.actor}`, object: { type: 'commit', sha: `${index}`.repeat(40) } }));
    if (path.includes('/git/commits/')) data = { tree: { sha: path.split('/').at(-1) }, parents: [] };
    if (path.includes('/git/trees/')) {
      const index = Number(path.split('/').at(-1)![0]);
      data = { tree: [{ path: 'event.json', type: 'blob', sha: `${index}event` }, { path: 'signature', type: 'blob', sha: `${index}signature` }] };
    }
    if (path.includes('/git/blobs/')) {
      const blob = path.split('/').at(-1)!;
      const parent = parents[Number(blob[0])];
      const content = blob.endsWith('event') ? parent.payload : parent.signature;
      data = { content: Buffer.from(content).toString('base64'), encoding: 'base64', size: Buffer.byteLength(content) };
    }
    if (request.method() === 'POST') {
      if (path.endsWith('/git/trees')) published = JSON.parse(request.postDataJSON().tree.find((entry: any) => entry.path === 'event.json').content);
      data = { sha: 'f'.repeat(40) };
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.locator('#title').fill('Issue draft');
  await page.locator('#object-type').selectOption('project');
  await page.locator('#title').fill('Project draft');
  await page.locator('#object-type').selectOption('issue');
  await expect(page.locator('#title')).toHaveValue('Issue draft');
  await page.locator('#object-type').selectOption('project');
  await expect(page.locator('#title')).toHaveValue('Project draft');
  await page.getByRole('tab', { name: 'Existing projects', exact: true }).tap();
  await expect(page.locator('#issues-status')).toHaveText('1 signed project opening.');
  await expect(page.locator('.issue-card h2')).toHaveText('Parent project');
  await page.getByRole('tab', { name: 'New signed project', exact: true }).tap();
  for (const type of ['project', 'discussion', 'workflow', 'project-item', 'discussion-reply']) {
    await page.locator('#object-type').selectOption(type);
    await page.locator('#token').fill('mock-token');
    await page.locator('#name').fill('Resource author');
    if (type !== 'discussion-reply') await page.locator('#title').fill(`${type} title`);
    await page.locator('#body').fill(`${type} body`);
    if (type === 'workflow') await page.locator('#workflow-name').fill('check');
    if (type === 'project-item') {
      await page.locator('#parent-id').fill(parents[0].id);
      await page.locator('#project-revision').fill(parents[0].id);
    }
    if (type === 'discussion-reply') await page.locator('#parent-id').fill(parents[1].id);
    await page.locator('#submit').tap();
    await expect(page.locator('#status')).toContainText('Published.');
    expect(published.kind).toBe(`${type}.open`);
    expect(published.intent).toBe('open');
    expect(published.title).toBeUndefined();
    expect(JSON.parse(published.body).schema).toBe(`hn.${type}/1`);
    if (type === 'workflow') expect(JSON.parse(published.body).enabled).toBe(false);
  }
});
