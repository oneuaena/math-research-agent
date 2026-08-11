import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let app: ElectronApplication;
let page: Page;
let server: Server;
let baseUrl = '';
let responseStatus = 200;
let captured: { path: string; method: string; authorization: boolean; body: Record<string, unknown> } | null = null;

test.beforeEach(async () => {
  server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk.toString(); });
    request.on('end', () => {
      captured = { path: request.url || '', method: request.method || '', authorization: request.headers.authorization === 'Bearer test-credential', body: JSON.parse(raw) as Record<string, unknown> };
      response.writeHead(responseStatus, { 'Content-Type': 'application/json' });
      response.end(responseStatus === 200
        ? JSON.stringify({ object: 'chat.completion', model: 'test-model', choices: [{ message: { content: 'OK' } }] })
        : JSON.stringify({ error: { type: 'test_error', message: `HTTP ${responseStatus}` } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  baseUrl = `http://127.0.0.1:${address.port}`;
  const userData = mkdtempSync(join(tmpdir(), 'mra-provider-e2e-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, MRA_TEST_USER_DATA: userData } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (await page.evaluate(() => localStorage.getItem('mra-language')) !== 'en') await page.getByRole('button', { name: 'Switch language' }).click();
});

test.afterEach(async () => {
  await app?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('test connection uses a non-streaming minimal chat request and maps HTTP errors', async () => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  const providerFields = dialog.locator('.settings-grid').first();
  await providerFields.locator('select').selectOption('openai-compatible');
  await providerFields.locator('input').nth(0).fill('test-model');
  await providerFields.locator('input').nth(1).fill(baseUrl);
  await providerFields.locator('input').nth(2).fill('test-credential');
  await expect(dialog.getByLabel('Provider HTTP timeout · seconds')).toHaveValue('180');
  await dialog.getByRole('button', { name: 'Test', exact: true }).click();
  const diagnostic = dialog.getByRole('region', { name: 'Provider diagnostic' });
  await expect(diagnostic.getByText('CONNECTED')).toBeVisible();
  await expect(diagnostic.getByText('200', { exact: true })).toBeVisible();
  expect(captured).toMatchObject({ path: '/chat/completions', method: 'POST', authorization: true });
  expect(captured?.body).toMatchObject({ model: 'test-model', messages: [{ role: 'user', content: 'Reply only with OK' }], stream: false, max_tokens: 8 });

  responseStatus = 402;
  await dialog.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(diagnostic.locator('header strong')).toHaveText('INSUFFICIENT_BALANCE');
  await expect(diagnostic.getByText('402', { exact: true })).toBeVisible();

  responseStatus = 503;
  await dialog.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(diagnostic.locator('header strong')).toHaveText('OVERLOADED');
});
