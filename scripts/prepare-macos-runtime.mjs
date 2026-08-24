import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const requestedArch = process.argv[process.argv.indexOf('--arch') + 1];
if (!['arm64', 'x64'].includes(requestedArch)) throw new Error('Use --arch arm64 or --arch x64.');

const platformArch = requestedArch === 'arm64' ? 'aarch64' : 'x86_64';
const releaseTag = '20260814';
const pythonVersion = '3.12.14';
const pythonArchiveName = `cpython-${pythonVersion}+${releaseTag}-${platformArch}-apple-darwin-install_only_stripped.tar.gz`;
const pythonArchive = {
  url: `https://github.com/astral-sh/python-build-standalone/releases/download/${releaseTag}/${pythonArchiveName.replace('+', '%2B')}`,
  sha256: requestedArch === 'arm64'
    ? 'dd5b76ab11451a4a4367c17c61d944dded56b425396b07f102922a7ebef7d55f'
    : 'aec265e3cddaccdb2a3d783331596351b24d4a63c97af0a38f75f643c9451de9',
};

const commonWheels = [
  ['sympy-1.14.0-py3-none-any.whl', 'https://files.pythonhosted.org/packages/a2/09/77d55d46fd61b4a135c444fc97158ef34a095e5681d0a6c10b75bf356191/sympy-1.14.0-py3-none-any.whl', 'e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5'],
  ['mpmath-1.3.0-py3-none-any.whl', 'https://files.pythonhosted.org/packages/43/e3/7d92a15f894aa0c9c4b49b8ee9ac9850d6e63b03c9c32c0367a13ae62209/mpmath-1.3.0-py3-none-any.whl', 'a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c'],
];
const nativeWheels = requestedArch === 'arm64' ? [
  ['numpy-2.4.6-cp312-cp312-macosx_11_0_arm64.whl', 'https://files.pythonhosted.org/packages/ea/12/92c4c131527599e8288d6918e888d88726f84d805d784b771f32408aeaef/numpy-2.4.6-cp312-cp312-macosx_11_0_arm64.whl', 'ebfb099f8dcf083deef3ac1ca4c1503f387cf76296fcb3816b66f5ecb5f54fdb'],
  ['scipy-1.17.1-cp312-cp312-macosx_12_0_arm64.whl', 'https://files.pythonhosted.org/packages/b2/02/cf107b01494c19dc100f1d0b7ac3cc08666e96ba2d64db7626066cee895e/scipy-1.17.1-cp312-cp312-macosx_12_0_arm64.whl', 'fcb310ddb270a06114bb64bbe53c94926b943f5b7f0842194d585c65eb4edd76'],
  ['z3_solver-4.15.4.0-py3-none-macosx_13_0_arm64.whl', 'https://files.pythonhosted.org/packages/63/33/a3d5d2eaeb0f7b3174d57d405437eabb2075d4d50bd9ea0957696c435c7b/z3_solver-4.15.4.0-py3-none-macosx_13_0_arm64.whl', '407e825cc9211f95ef46bdc8d151bf630e7ab2d62a21d24cd74c09cc5b73f3aa'],
] : [
  ['numpy-2.4.6-cp312-cp312-macosx_10_13_x86_64.whl', 'https://files.pythonhosted.org/packages/95/2a/3d7b5ac8aac24feaf9ad7ed58f45b0bbc06d37e4338ae84c9f2298b570f9/numpy-2.4.6-cp312-cp312-macosx_10_13_x86_64.whl', '001fbb8e08d942dd57599e781f2472269ee7f2755fae407b4f67b2f0b17da3f1'],
  ['scipy-1.17.1-cp312-cp312-macosx_10_14_x86_64.whl', 'https://files.pythonhosted.org/packages/35/48/b992b488d6f299dbe3f11a20b24d3dda3d46f1a635ede1c46b5b17a7b163/scipy-1.17.1-cp312-cp312-macosx_10_14_x86_64.whl', '35c3a56d2ef83efc372eaec584314bd0ef2e2f0d2adb21c55e6ad5b344c0dcb8'],
  ['z3_solver-4.15.4.0-py3-none-macosx_13_0_x86_64.whl', 'https://files.pythonhosted.org/packages/47/84/fd7ffac1551cd9f8d44fe41358f738be670fc4c24dfd514fab503f2cf3e7/z3_solver-4.15.4.0-py3-none-macosx_13_0_x86_64.whl', '00bd10c5a6a5f6112d3a9a810d0799227e52f76caa860dafa5e00966bb47eb13'],
];
const wheels = [...commonWheels, ...nativeWheels].map(([filename, url, sha256]) => ({ filename, url, sha256 }));
const cache = join(root, 'runtime', 'cache', 'macos');
const archRoot = join(root, 'runtime', `mac-${requestedArch}`);
const pythonRoot = join(archRoot, 'python');

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(executable)} exited with code ${result.status}.`);
}

function download(artifact) {
  const target = join(cache, artifact.filename ?? basename(new URL(artifact.url).pathname));
  if (!existsSync(target) || hash(target) !== artifact.sha256) {
    if (existsSync(target)) rmSync(target, { force: true });
    const downloader = join(root, 'runtime', 'python', 'python.exe');
    run(downloader, [join(root, 'scripts', 'download-with-ranges.py'), artifact.url, target]);
  }
  const actual = hash(target);
  if (actual !== artifact.sha256) {
    rmSync(target, { force: true });
    throw new Error(`Checksum mismatch for ${basename(target)}: ${actual}`);
  }
  return target;
}

function removeGenerated(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') rmSync(target, { recursive: true, force: true });
      else removeGenerated(target);
    } else if (/\.py[co]$/i.test(entry.name)) rmSync(target, { force: true });
  }
}

mkdirSync(cache, { recursive: true });
const archive = download({ ...pythonArchive, filename: pythonArchiveName });
const wheelFiles = wheels.map((wheel) => ({ ...wheel, path: download(wheel) }));
rmSync(archRoot, { recursive: true, force: true });
mkdirSync(archRoot, { recursive: true });
const nonessentialSymlinks = [
  'python/bin/2to3',
  'python/bin/idle3',
  'python/bin/pydoc3',
  'python/bin/python',
  'python/bin/python3',
  'python/bin/python3-config',
  'python/lib/pkgconfig/python3-embed.pc',
  'python/lib/pkgconfig/python3.pc',
  'python/share/man/man1/python3.1',
];
run('tar.exe', ['-xf', archive, '-C', archRoot, ...nonessentialSymlinks.flatMap((entry) => ['--exclude', entry])]);
const executable = join(pythonRoot, 'bin', 'python3.12');
if (!existsSync(executable) || statSync(executable).size < 100_000) throw new Error(`macOS Python executable is missing: ${executable}`);
const sitePackages = join(pythonRoot, 'lib', 'python3.12', 'site-packages');
mkdirSync(sitePackages, { recursive: true });
for (const wheel of wheelFiles) run('tar.exe', ['-xf', wheel.path, '-C', sitePackages]);
removeGenerated(sitePackages);
chmodSync(executable, 0o755);

const header = readFileSync(executable).subarray(0, 8);
const magic = header.subarray(0, 4).toString('hex');
const cpuType = header.readUInt32LE(4);
const expectedCpuType = requestedArch === 'arm64' ? 0x0100000c : 0x01000007;
if (!['cffaedfe', 'feedfacf'].includes(magic) || cpuType !== expectedCpuType) throw new Error(`Unexpected Mach-O header for ${requestedArch}: ${magic}/${cpuType.toString(16)}`);

writeFileSync(join(pythonRoot, 'RUNTIME_MANIFEST.json'), `${JSON.stringify({
  source: pythonArchive.url,
  archiveSha256: pythonArchive.sha256,
  architecture: `darwin-${requestedArch}`,
  python: pythonVersion,
  minimumMacOS: '13.0',
  packages: { sympy: '1.14.0', numpy: '2.4.6', scipy: '1.17.1', z3: '4.15.4.0' },
  wheels: wheels.map(({ filename, sha256 }) => ({ filename, sha256 })),
}, null, 2)}\n`, 'utf8');
console.log(`MACOS_RUNTIME_READY ${JSON.stringify({ arch: requestedArch, python: pythonVersion, executable, packages: wheels.length })}`);
