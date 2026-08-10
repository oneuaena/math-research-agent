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
  if (await page.evaluate(() => localStorage.getItem('mra-language')) !== 'en') await page.getByRole('button', { name: 'Switch language' }).click();
}

test.beforeEach(async () => { userData = mkdtempSync(join(tmpdir(), 'mra-v1-e2e-')); await launch(); });
test.afterEach(async () => { await app?.close(); });

test('natural-language research persists specification, branches, proof critique, and resumes after restart', async () => {
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name').fill('Compactness route');
  await dialog.getByLabel('Statement').fill('Determine whether every finitely satisfiable family in this abstract system has a global realization.');
  await dialog.getByLabel('Variables').fill('F');
  await dialog.getByLabel('Domain').fill('families of constraints');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Research session' })).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/PAUSED · PAUSED/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('natural-language', { exact: true })).toBeVisible();
  await expect(page.getByText('A natural-language specification was validated')).toBeVisible();

  await page.getByRole('button', { name: 'Research branches' }).click();
  await expect(page.getByRole('heading', { name: 'Research branches' })).toBeVisible();
  await expect(page.locator('.branch-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Structured proofs' }).click();
  await expect(page.getByText('NOT VERIFIED').first()).toBeVisible();
  await expect(page.getByText(/REQUIRES_LEMMA|UNCERTAIN/).first()).toBeVisible();

  await app.close();
  await launch();
  await page.getByRole('heading', { name: 'Compactness route' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText(/PAUSED · PAUSED/)).toBeVisible({ timeout: 45_000 });
});

test('Chinese autonomous operation surface runs without English-only controls', async () => {
  await page.getByRole('button', { name: 'Switch language' }).click();
  await page.getByRole('button', { name: '新建项目' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('项目名称').fill('中文研究会话');
  await dialog.getByLabel('猜想陈述').fill('判断每个满足局部一致性的约束族是否都存在整体实现。');
  await dialog.getByLabel('变量').fill('F');
  await dialog.getByLabel('定义域').fill('约束族');
  await dialog.getByRole('button', { name: '创建项目' }).click();
  await expect(page.getByRole('heading', { name: '研究会话' })).toBeVisible();
  await page.getByRole('button', { name: '运行' }).click();
  await expect(page.getByText('已暂停 · 已暂停')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('数学规格', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '研究分支' }).click();
  await expect(page.getByRole('heading', { name: '研究分支' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('chinese-autonomous.png'), fullPage: true });
});

test('validated executable specification produces exact counterexample evidence', async () => {
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name').fill('Prime claim');
  await dialog.getByLabel('Statement').fill('For every positive integer n, n²+n+1 is prime.');
  await dialog.getByLabel('Variables').fill('n');
  await dialog.getByLabel('Domain').fill('positive integers');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('COMPLETE · COMPLETE')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('machine-executable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Proof graph' }).click();
  await expect(page.getByText('Exact counterexample candidate')).toBeVisible();
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
});
