import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const executablePath = process.env.MRA_EXECUTABLE_PATH || join(process.cwd(), 'release', 'win-unpacked', 'Math Research Agent.exe');
const userData = mkdtempSync(join(tmpdir(), 'mra-runtime-smoke-'));
const systemRoot = process.env.SYSTEMROOT || 'C:\\Windows';
const app = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    PATH: join(systemRoot, 'System32'),
    MRA_TEST_USER_DATA: userData,
  },
});

try {
  const page = await app.firstWindow();
  await page.getByText('Math Research Agent', { exact: true }).first().waitFor({ timeout: 30_000 });
  const result = await page.evaluate(async () => {
    const diagnostics = await window.research.system.runtimeDiagnostics();
    const snapshot = await window.research.projects.create({
      name: 'Bundled runtime smoke', question: 'Verify local runtime availability.', goal: 'Smoke test', background: '',
      knownResults: '', constraints: 'Synthetic test data only.', mode: 'experiment', variables: 'x', domain: 'Integers', assumptions: '', notes: '', demoCaseId: null,
    });
    const arithmetic = await window.research.tools.run({ projectId: snapshot.project.id, name: 'run_python', purpose: 'Smoke test arithmetic', input: { code: 'result = 2 + 2' } });
    const factorization = await window.research.tools.run({ projectId: snapshot.project.id, name: 'run_python', purpose: 'Smoke test SymPy', input: { code: "import sympy as sp\nx = sp.Symbol('x')\nresult = sp.factor(x**2 - 1)" } });
    const z3 = await window.research.tools.run({ projectId: snapshot.project.id, name: 'z3_check', purpose: 'Smoke test Z3', input: { smt2: '(declare-const x Int) (assert (> x 1)) (assert (< x 3))' } });
    return { diagnostics, arithmetic, factorization, z3 };
  });
  if (!result.diagnostics.ok || result.diagnostics.source !== 'bundled') throw new Error(`Runtime diagnostics failed: ${JSON.stringify(result.diagnostics)}`);
  if (!result.arithmetic.ok || result.arithmetic.output.trim() !== '4') throw new Error(`Arithmetic failed: ${JSON.stringify(result.arithmetic)}`);
  if (!result.factorization.ok || result.factorization.output.replace(/\s/g, '') !== '(x-1)*(x+1)') throw new Error(`SymPy failed: ${JSON.stringify(result.factorization)}`);
  if (!result.z3.ok || JSON.parse(result.z3.output).status !== 'sat') throw new Error(`Z3 failed: ${JSON.stringify(result.z3)}`);
  console.log(`PACKAGED_RUNTIME_SMOKE_OK ${JSON.stringify({
    runtime: result.diagnostics.displayPath,
    python: result.diagnostics.python.version,
    sympy: result.diagnostics.sympy.version,
    numpy: result.diagnostics.numpy.version,
    scipy: result.diagnostics.scipy.version,
    z3: result.diagnostics.z3.version,
  })}`);
} finally {
  await app.close();
}
