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
