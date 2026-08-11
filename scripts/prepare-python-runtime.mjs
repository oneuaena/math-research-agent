import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const runtimeRoot = join(root, 'runtime');
const output = join(runtimeRoot, 'python');
const cache = join(runtimeRoot, 'cache');
const archiveName = 'python-3.12.10-embed-amd64.zip';
const archive = join(cache, archiveName);
const wheelCache = join(cache, 'wheels');
const requirements = join(root, 'python', 'requirements-bundled.txt');
const url = `https://www.python.org/ftp/python/3.12.10/${archiveName}`;
const expectedSha256 = '4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3';
const buildPython = process.env.MRA_BUILD_PYTHON || 'python';
const wheelPlan = [
  { project: 'sympy', version: '1.14.0', suffix: '-py3-none-any.whl' },
  { project: 'mpmath', version: '1.3.0', suffix: '-py3-none-any.whl' },
  { project: 'numpy', version: '2.4.6', suffix: '-cp312-cp312-win_amd64.whl' },
  { project: 'scipy', version: '1.17.1', suffix: '-cp312-cp312-win_amd64.whl' },
  { project: 'z3-solver', version: '4.15.4.0', suffix: '-py3-none-win_amd64.whl' },
];

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(executable)} exited with code ${result.status}.`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

function removeNonPortableGeneratedFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__' || (directory.endsWith(join('Lib', 'site-packages')) && entry.name === 'bin')) {
        rmSync(target, { recursive: true, force: true });
      } else {
        removeNonPortableGeneratedFiles(target);
      }
    } else if (/\.py[co]$/i.test(entry.name)) {
      rmSync(target, { force: true });
    }
  }
}

function download() {
  if (existsSync(archive) && sha256(archive) === expectedSha256) return;
  run('curl.exe', [
    '--fail', '--location', '--silent', '--show-error', '--retry', '5', '--retry-all-errors',
    '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', '30',
    '--continue-at', '-', url, '--output', archive,
  ]);
  const actual = sha256(archive);
  if (actual !== expectedSha256) {
    rmSync(archive, { force: true });
    throw new Error(`CPython archive checksum mismatch: expected ${expectedSha256}, received ${actual}.`);
  }
}

function fetchJson(url) {
  return JSON.parse(execFileSync('curl.exe', [
    '--fail', '--location', '--silent', '--show-error', '--retry', '5', '--retry-all-errors', url,
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
}

function downloadWheels() {
  return wheelPlan.map((planned) => {
    const metadata = fetchJson(`https://pypi.org/pypi/${planned.project}/${planned.version}/json`);
    const artifact = metadata.urls.find((item) => item.packagetype === 'bdist_wheel' && item.filename.endsWith(planned.suffix));
    if (!artifact?.url || !artifact?.digests?.sha256) {
      throw new Error(`No PyPI wheel matched ${planned.project} ${planned.version} ${planned.suffix}.`);
    }
    const target = join(wheelCache, artifact.filename);
    const expected = artifact.digests.sha256.toUpperCase();
    for (let attempt = 0; attempt < 5 && (!existsSync(target) || sha256(target) !== expected); attempt += 1) {
      if (existsSync(target) && statSync(target).size >= artifact.size) rmSync(target, { force: true });
      run('curl.exe', [
        '--fail', '--location', '--silent', '--show-error', '--retry', '5', '--retry-all-errors',
        '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', '30',
        '--continue-at', '-', artifact.url, '--output', target,
      ]);
    }
    const actual = sha256(target);
    if (actual !== expected) {
      rmSync(target, { force: true });
      throw new Error(`Wheel checksum mismatch for ${artifact.filename}.`);
    }
    return { project: planned.project, version: planned.version, filename: artifact.filename, sha256: expected };
  });
}

mkdirSync(cache, { recursive: true });
mkdirSync(wheelCache, { recursive: true });
const version = execFileSync(buildPython, ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], { encoding: 'utf8' }).trim();
if (version !== '3.12') throw new Error(`Runtime preparation requires build-time Python 3.12; received ${version}. Set MRA_BUILD_PYTHON if needed.`);
download();
const wheels = downloadWheels();
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
run('tar.exe', ['-xf', archive, '-C', output]);

writeFileSync(join(output, 'python312._pth'), ['python312.zip', '.', 'Lib/site-packages', 'import site', ''].join('\n'), 'utf8');
const sitePackages = join(output, 'Lib', 'site-packages');
mkdirSync(sitePackages, { recursive: true });
run(buildPython, [
  '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-compile',
  '--no-index', '--find-links', wheelCache, '--target', sitePackages, '-r', requirements,
], { env: { ...process.env, PIP_NO_INPUT: '1' } });

const probe = execFileSync(join(output, 'python.exe'), ['-I', '-B', '-X', 'utf8', '-c', [
  'import json, sys, sympy, numpy, scipy, z3',
  'print(json.dumps({"python": sys.version.split()[0], "sympy": sympy.__version__, "numpy": numpy.__version__, "scipy": scipy.__version__, "z3": z3.get_version_string()}))',
].join('; ')], {
  encoding: 'utf8',
  windowsHide: true,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONUTF8: '1' },
}).trim();
const packages = JSON.parse(probe);
removeNonPortableGeneratedFiles(sitePackages);
writeFileSync(join(output, 'RUNTIME_MANIFEST.json'), `${JSON.stringify({
  source: url,
  archiveSha256: expectedSha256,
  architecture: 'win32-x64',
  packages,
  wheels,
}, null, 2)}\n`, 'utf8');
console.log(`BUNDLED_RUNTIME_READY ${JSON.stringify(packages)}`);
