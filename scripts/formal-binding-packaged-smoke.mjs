import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userData = mkdtempSync(join(tmpdir(), 'mra-binding-smoke-'));
const app = await electron.launch({ executablePath: join(process.cwd(), 'release', 'win-unpacked', 'Math Research Agent.exe'), env: { ...process.env, MRA_TEST_USER_DATA: userData } });
try {
  const page = await app.firstWindow();
  const result = await page.evaluate(async () => {
    const snapshot = await window.research.projects.create({ name: 'Formal binding smoke', question: 'Every natural number equals itself.', goal: 'Test binding gate', background: '', knownResults: '', constraints: '', mode: 'formalize', variables: 'n', domain: 'Nat', assumptions: '', notes: '', demoCaseId: null });
    const source = 'example (n : Nat) : n = n := by\n  rfl';
    const binding = await window.research.formalBindings.create(snapshot.project.id, snapshot.project.question, 'forall n : Nat, n = n', source);
    const verified = await window.research.formalBindings.verify(snapshot.project.id, binding.id, source);
    const swapped = await window.research.formalBindings.verify(snapshot.project.id, binding.id, 'example (n : Nat) : n + 0 = n := by\n  omega');
    return { binding, verified, swapped };
  });
  if (!result.verified.ok || result.binding.status !== 'BOUND') throw new Error(`Formal binding was not persisted and verified: ${JSON.stringify(result)}`);
  if (result.swapped.ok || !result.swapped.error?.includes('FORMAL_BINDING_MISMATCH')) throw new Error(`Statement swap was not rejected: ${JSON.stringify(result)}`);
  console.log('PACKAGED_FORMAL_BINDING_SMOKE_OK');
} finally {
  await app.close();
}
