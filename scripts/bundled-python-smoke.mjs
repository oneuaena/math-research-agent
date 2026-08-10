import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const root = process.cwd();
const python = process.env.MRA_BUNDLED_PYTHON_PATH || join(root, 'runtime', 'python', 'python.exe');
const worker = join(root, 'python', 'worker.py');
const systemRoot = process.env.SYSTEMROOT || 'C:\\Windows';
const cleanEnv = {
  SYSTEMROOT: systemRoot,
  WINDIR: systemRoot,
  PATH: `${dirname(python)};${join(systemRoot, 'System32')}`,
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
  PYTHONNOUSERSITE: '1',
  PYTHONDONTWRITEBYTECODE: '1',
};
const projectId = '00000000-0000-4000-8000-000000000002';

function invoke(name, input) {
  const result = spawnSync(python, ['-I', worker], {
    cwd: root,
    env: cleanEnv,
    encoding: 'utf8',
    windowsHide: true,
    input: JSON.stringify({ projectId, name, purpose: 'Bundled runtime smoke test', input }),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `Worker exited with ${result.status}.`);
  const parsed = JSON.parse(result.stdout.trim());
  if (!parsed.ok) throw new Error(parsed.error || `${name} failed.`);
  return parsed.output;
}

const capabilities = JSON.parse(invoke('capability_check', {}));
const arithmetic = invoke('run_python', { code: 'result = 2 + 2' });
const factorization = invoke('run_python', { code: "import sympy as sp\nx = sp.Symbol('x')\nresult = sp.factor(x**2 - 1)" });
const z3 = JSON.parse(invoke('z3_check', { smt2: '(declare-const x Int) (assert (> x 1)) (assert (< x 3))' }));

if (!capabilities.python.available || !capabilities.sympy.available) throw new Error('Bundled Python or SymPy is unavailable.');
if (arithmetic.trim() !== '4') throw new Error(`Unexpected arithmetic result: ${arithmetic}`);
if (factorization.replace(/\s/g, '') !== '(x-1)*(x+1)') throw new Error(`Unexpected factorization: ${factorization}`);
if (z3.status !== 'sat') throw new Error(`Unexpected Z3 result: ${JSON.stringify(z3)}`);

console.log(`BUNDLED_PYTHON_SMOKE_OK ${JSON.stringify({
  path: 'runtime/python/python.exe',
  python: capabilities.python.version,
  sympy: capabilities.sympy.version,
  numpy: capabilities.numpy.version,
  scipy: capabilities.scipy.version,
  z3: capabilities.z3.version,
  arithmetic,
  factorization,
  z3Status: z3.status,
})}`);
