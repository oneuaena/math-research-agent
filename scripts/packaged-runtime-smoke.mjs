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
    const printed = await window.research.tools.run({ projectId: snapshot.project.id, name: 'run_python', purpose: 'Smoke test stdout protocol', input: { code: 'print("hello")' } });
    const unicode = await window.research.tools.run({ projectId: snapshot.project.id, name: 'run_python', purpose: 'Smoke test Unicode', input: { code: 'print("中文输出")' } });
    const programError = await window.research.tools.run({ projectId: snapshot.project.id, name: 'run_python', purpose: 'Smoke test program error', input: { code: '1 / 0' } });
    const factorization = await window.research.tools.run({ projectId: snapshot.project.id, name: 'run_python', purpose: 'Smoke test SymPy', input: { code: "import sympy as sp\nx = sp.Symbol('x')\nresult = sp.factor(x**2 - 1)" } });
    const z3 = await window.research.tools.run({ projectId: snapshot.project.id, name: 'z3_check', purpose: 'Smoke test Z3', input: { smt2: '(declare-const x Int) (assert (> x 1)) (assert (< x 3))' } });
    const z3Unsat = await window.research.tools.run({ projectId: snapshot.project.id, name: 'z3_check', purpose: 'Smoke test Z3 UNSAT', input: { smt2: '(declare-const x Int) (assert (> x 1)) (assert (< x 0))' } });
    const leanSource = 'example (n : Nat) : n = n := by\n  rfl';
    const leanBinding = diagnostics.lean.available
      ? await window.research.formalBindings.freezeUserConfirmed(snapshot.project.id, 'Every natural n equals itself.', 'forall n : Nat, n = n', leanSource)
      : null;
    const lean = diagnostics.lean.available
      ? await window.research.tools.run({ projectId: snapshot.project.id, name: 'lean_check', purpose: 'Smoke test Lean kernel', input: { code: leanSource, bindingId: leanBinding.id } })
      : null;
    const invalidLeanSource = 'example : False := by\n  trivial';
    const invalidBinding = diagnostics.lean.available
      ? await window.research.formalBindings.freezeUserConfirmed(snapshot.project.id, 'False.', 'False', invalidLeanSource)
      : null;
    const leanInvalid = diagnostics.lean.available
      ? await window.research.tools.run({ projectId: snapshot.project.id, name: 'lean_check', purpose: 'Smoke test Lean rejection', input: { code: invalidLeanSource, bindingId: invalidBinding.id } })
      : null;
    return { diagnostics, arithmetic, printed, unicode, programError, factorization, z3, z3Unsat, lean, leanInvalid };
  });
  if (!result.diagnostics.ok || result.diagnostics.source !== 'bundled') throw new Error(`Runtime diagnostics failed: ${JSON.stringify(result.diagnostics)}`);
  if (!result.arithmetic.ok || result.arithmetic.output.trim() !== '4') throw new Error(`Arithmetic failed: ${JSON.stringify(result.arithmetic)}`);
  if (!result.printed.ok || result.printed.stdout !== 'hello\n' || result.printed.errorType !== 'NONE') throw new Error(`Stdout protocol failed: ${JSON.stringify(result.printed)}`);
  if (!result.unicode.ok || result.unicode.stdout !== '中文输出\n') throw new Error(`Unicode failed: ${JSON.stringify(result.unicode)}`);
  if (result.programError.ok || result.programError.errorType !== 'PROGRAM_ERROR' || result.programError.exitCode !== 1 || !result.programError.stderr.includes('ZeroDivisionError')) throw new Error(`Program error mapping failed: ${JSON.stringify(result.programError)}`);
  if (!result.factorization.ok || result.factorization.output.replace(/\s/g, '') !== '(x-1)*(x+1)') throw new Error(`SymPy failed: ${JSON.stringify(result.factorization)}`);
  if (!result.z3.ok || result.z3.verificationStatus !== 'SAT' || JSON.parse(result.z3.output).status !== 'SAT') throw new Error(`Z3 SAT failed: ${JSON.stringify(result.z3)}`);
  if (!result.z3Unsat.ok || result.z3Unsat.verificationStatus !== 'UNSAT' || JSON.parse(result.z3Unsat.output).status !== 'UNSAT') throw new Error(`Z3 UNSAT failed: ${JSON.stringify(result.z3Unsat)}`);
  if (result.lean && (!result.lean.ok || result.lean.verificationStatus !== 'FORMALLY_VERIFIED')) throw new Error(`Lean kernel failed: ${JSON.stringify(result.lean)}`);
  if (result.leanInvalid && (result.leanInvalid.ok || result.leanInvalid.errorType !== 'PROGRAM_ERROR')) throw new Error(`Lean rejection failed: ${JSON.stringify(result.leanInvalid)}`);
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
