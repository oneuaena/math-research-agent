import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const executablePath = process.env.MRA_EXECUTABLE_PATH || join(process.cwd(), 'release', 'win-unpacked', 'Math Research Agent.exe');
const userData = mkdtempSync(join(tmpdir(), 'mra-packaged-'));
const app = await electron.launch({ executablePath, env: { ...process.env, MRA_TEST_USER_DATA: userData } });
try {
  const page = await app.firstWindow();
  await page.getByText('提出问题，持续研究。').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '新建项目' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '压力测试' }).click();
  await page.getByRole('button', { name: /A · 快速发现反例/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '创建项目' }).click();
  await page.getByRole('button', { name: '运行压力测试' }).click();
  await page.getByRole('heading', { name: '发现反例' }).waitFor({ timeout: 30_000 });
  console.log('PACKAGED_SMOKE_OK');
} finally {
  await app.close();
}
