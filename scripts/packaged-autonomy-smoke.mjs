import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const executablePath = process.env.MRA_EXECUTABLE_PATH || join(process.cwd(), 'release', 'win-unpacked', 'Math Research Agent.exe');
const userData = mkdtempSync(join(tmpdir(), 'mra-autonomy-smoke-'));
const app = await electron.launch({ executablePath, env: { ...process.env, MRA_TEST_USER_DATA: userData } });

try {
  const page = await app.firstWindow();
  const projectId = await page.evaluate(async () => {
    const settings = await window.research.settings.get();
    await window.research.settings.save({ ...settings, checkpointEvery: 1, maxIterations: 500, maxResearchMinutes: 5 });
    const snapshot = await window.research.projects.create({
      name: 'Packaged autonomy smoke', question: 'Explore whether every finite local consistency condition extends globally.',
      goal: 'Exercise persistent checkpoint continuation.', background: '', knownResults: '', constraints: '', mode: 'autonomous',
      variables: 'F', domain: 'finite constraint families', assumptions: '', notes: '', demoCaseId: null,
    });
    await window.research.agent.start(snapshot.project.id);
    return snapshot.project.id;
  });
  await page.waitForFunction(async (id) => (await window.research.projects.get(id)).researchSteps.length >= 4, projectId, { timeout: 30_000 });
  const before = await page.evaluate(async (id) => (await window.research.projects.get(id)).researchSteps.length, projectId);
  await page.close();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (app.process().exitCode !== null) throw new Error(`Packaged process exited after its window closed: ${app.process().exitCode}`);
  const windows = app.windows();
  if (windows.length !== 0) throw new Error(`Expected no visible research window, found ${windows.length}.`);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (app.process().exitCode !== null) throw new Error('Packaged background research process did not remain alive.');
  console.log(`PACKAGED_AUTONOMY_SMOKE_OK ${JSON.stringify({ projectId, stepsBeforeWindowClose: before, processAlive: true })}`);
} finally {
  await app.close();
}
