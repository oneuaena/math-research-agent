import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  await expect(page.getByText('A natural-language specification was validated').first()).toBeVisible();

  await page.getByRole('button', { name: 'Research branches' }).click();
  await expect(page.getByRole('heading', { name: 'Research branches' })).toBeVisible();
  await expect(page.locator('.branch-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Structured proofs' }).click();
  await expect(page.getByText('NOT VERIFIED').first()).toBeVisible();
  await expect(page.getByText(/REQUIRES_LEMMA|UNCERTAIN/).first()).toBeVisible();

  await page.evaluate(async () => {
    const settings = await window.research.settings.get();
    await window.research.settings.save({ ...settings, checkpointEvery: 1, maxIterations: 500 });
  });

  await app.close();
  await launch();
  await page.getByRole('heading', { name: 'Compactness route' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  let previous = await page.evaluate(async () => {
    const project = (await window.research.projects.list()).find((item) => item.name === 'Compactness route')!;
    const snapshot = await window.research.projects.get(project.id);
    const session = snapshot.sessions.at(-1)!;
    return { cycleId: session.cycleId, cycleIndex: session.cycleIndex, actionCount: session.actionCount, stepCount: snapshot.researchSteps.length };
  });

  for (let expectedCycle = 1; expectedCycle <= 5; expectedCycle += 1) {
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const project = (await window.research.projects.list()).find((item) => item.name === 'Compactness route')!;
      const snapshot = await window.research.projects.get(project.id);
      const session = snapshot.sessions.at(-1)!;
      return `${session.status}:${session.nextStage}:${session.cycleIndex}`;
    }), { timeout: 45_000 }).toBe(`PAUSED:PAUSED:${expectedCycle}`);
    const resumed = await page.evaluate(async () => {
      const project = (await window.research.projects.list()).find((item) => item.name === 'Compactness route')!;
      const snapshot = await window.research.projects.get(project.id);
      const session = snapshot.sessions.at(-1)!;
      return { cycleId: session.cycleId, cycleIndex: session.cycleIndex, actionCount: session.actionCount, stepCount: snapshot.researchSteps.length };
    });
    expect(resumed.cycleId).not.toBe(previous.cycleId);
    expect(resumed.actionCount).toBeGreaterThan(previous.actionCount);
    expect(resumed.stepCount).toBeGreaterThan(previous.stepCount);
    previous = resumed;
  }

  const stateLog = readFileSync(join(userData, 'logs', 'research-state.jsonl'), 'utf8')
    .trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
  const completedCycles = stateLog.filter((entry) => entry.event === 'loop_stopped' && entry.cycle_completed === true);
  expect(completedCycles).toHaveLength(6);
  expect(completedCycles.at(-1)).toMatchObject({
    cycle_index: 5,
    paused: true,
    pending_tasks: 0,
    agent_loop_running: false,
    resume_requested: true,
  });
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

test('project chat persists and an imported document is indexed visibly', async () => {
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name').fill('Document chat');
  await dialog.getByLabel('Statement').fill('Track the imported invariant.');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  const documentPath = join(userData, 'reference.txt');
  writeFileSync(documentPath, 'Reference marker: the amber invariant equals 31.\n\nThis is the final paragraph.', 'utf8');
  await page.evaluate(async (path) => {
    const project = (await window.research.projects.list()).find((item) => item.name === 'Document chat')!;
    await window.research.documents.importPaths(project.id, [path]);
  }, documentPath);
  await page.reload();
  await page.getByRole('heading', { name: 'Document chat' }).click();
  await page.getByRole('button', { name: 'Papers & sources' }).click();
  await expect(page.getByText(/Indexed · \d+ characters/)).toBeVisible();
  await page.getByRole('button', { name: 'Research chat' }).click();
  const composer = page.getByPlaceholder('Ask a question…');
  await composer.fill('Remember this conversation turn.');
  await composer.press('Enter');
  await expect(page.getByText(/Local coordinator received: Remember this conversation turn/)).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    const project = (await window.research.projects.list()).find((item) => item.name === 'Document chat')!;
    return (await window.research.projects.get(project.id)).messages.length;
  })).toBe(2);
});
