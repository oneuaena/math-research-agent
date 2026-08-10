import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let app: ElectronApplication;
let page: Page;
let userData: string;

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.'], env: { ...process.env, MRA_TEST_USER_DATA: userData } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (await page.evaluate(() => localStorage.getItem('mra-language')) !== 'en') {
    await page.getByRole('button', { name: 'Switch language' }).click();
  }
}

async function createAndRun(demoLabel: string, expectedStatus: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Stress test' }).click();
  await page.getByRole('button', { name: new RegExp(demoLabel) }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Conjecture stress test' })).toBeVisible();
  await page.getByRole('button', { name: 'Run stress test' }).click();
  await expect(page.getByRole('heading', { name: expectedStatus })).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async () => { userData = mkdtempSync(join(tmpdir(), 'mra-e2e-')); await launch(); });
test.afterEach(async () => { await app?.close(); });

test('Case A finds an early counterexample with exact independent verification', async () => {
  await createAndRun('A · Early counterexample', 'COUNTEREXAMPLE FOUND');
  await expect(page.getByText('EXACTLY VERIFIED').first()).toBeVisible();
  await expect(page.locator('.counterexample-value strong')).toHaveText('4');
  await expect(page.getByText('Independent rerun')).toBeVisible();
});

test('Case B expands the search before finding n = 40', async () => {
  await createAndRun('B · Expanded search', 'COUNTEREXAMPLE FOUND');
  await expect(page.locator('.coverage-grid').getByText('Integers 0 ≤ n ≤ 20')).toBeVisible();
  await expect(page.locator('.coverage-grid').getByText('Integers 21 ≤ n ≤ 100')).toBeVisible();
  await expect(page.locator('.counterexample-value strong')).toHaveText('40');
});

test('Case C reports survived testing and persists after restart', async () => {
  await createAndRun('C · Survived testing', 'SURVIVED TESTING');
  await expect(page.getByText('This is not a proof.').first()).toBeVisible();
  await expect(page.getByText('No counterexample was found within the tested search space.')).toBeVisible();
  await app.close();

  await launch();
  await page.getByRole('heading', { name: 'Consecutive-product parity' }).click();
  await expect(page.getByRole('heading', { name: 'SURVIVED TESTING' })).toBeVisible();
  await expect(page.getByText('This is not a proof.').first()).toBeVisible();
});

test('Chinese operation flow creates a project and presents exact evidence', async () => {
  await page.getByRole('button', { name: 'Switch language' }).click();
  await page.getByRole('button', { name: '新建项目' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '压力测试' }).click();
  await page.getByRole('button', { name: /A · 快速发现反例/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '创建项目' }).click();
  await expect(page.getByRole('heading', { name: '猜想压力测试' })).toBeVisible();
  await page.getByRole('button', { name: '运行压力测试' }).click();
  await expect(page.getByRole('heading', { name: '发现反例' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('精确验证').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('chinese-result.png'), fullPage: true });
});
