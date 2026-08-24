import { createPackageWithOptions, extractAll, listPackage, statFile } from '@electron/asar';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arch = process.argv[process.argv.indexOf('--arch') + 1];
if (!['arm64', 'x64'].includes(arch)) throw new Error('Use --arch arm64 or --arch x64.');

const workRoot = resolve(root, 'work');
const releaseRoot = resolve(root, 'release', 'mac-asars');
const staging = resolve(workRoot, `macos-asar-${arch}`);
const canvasStaging = resolve(workRoot, `macos-canvas-${arch}`);
const outputRoot = resolve(releaseRoot, arch);
for (const path of [staging, canvasStaging, outputRoot]) {
  const allowed = path.startsWith(`${workRoot}${sep}`) || path.startsWith(`${releaseRoot}${sep}`);
  if (!allowed) throw new Error(`Unsafe generated-directory path: ${path}`);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

const sourceAsar = join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const canvasArchive = join(root, 'runtime', 'cache', 'macos', `napi-rs-canvas-darwin-${arch}-0.1.80.tgz`);
if (!existsSync(sourceAsar) || !existsSync(canvasArchive)) throw new Error('Required app.asar or Canvas archive is missing.');

extractAll(sourceAsar, staging);
const winCanvas = resolve(staging, 'node_modules', '@napi-rs', 'canvas-win32-x64-msvc');
if (!winCanvas.startsWith(`${staging}${sep}`)) throw new Error('Unsafe Windows Canvas path.');
rmSync(winCanvas, { recursive: true, force: true });

const extraction = spawnSync('tar.exe', ['-xf', canvasArchive, '-C', canvasStaging], { cwd: root, stdio: 'inherit', windowsHide: true });
if (extraction.error) throw extraction.error;
if (extraction.status !== 0) throw new Error(`tar.exe exited with code ${extraction.status}.`);
const canvasPackage = join(canvasStaging, 'package');
const canvasDestination = join(staging, 'node_modules', '@napi-rs', `canvas-darwin-${arch}`);
cpSync(canvasPackage, canvasDestination, { recursive: true });

const outputAsar = join(outputRoot, 'app.asar');
await createPackageWithOptions(staging, outputAsar, { unpack: '**/*.node' });
const nativePath = `node_modules/@napi-rs/canvas-darwin-${arch}/skia.darwin-${arch}.node`;
const entries = listPackage(outputAsar).map((entry) => entry.replace(/^\\/, '').replaceAll('\\', '/'));
if (!entries.includes(nativePath)) throw new Error(`Darwin Canvas is missing from app.asar index: ${nativePath}`);
if (entries.some((entry) => entry.includes('canvas-win32'))) throw new Error('Windows Canvas leaked into macOS app.asar.');
const archiveNativePath = nativePath.replaceAll('/', '\\');
if (!statFile(outputAsar, archiveNativePath).unpacked) throw new Error('Darwin Canvas native module was not marked unpacked.');
const unpackedNative = join(`${outputAsar}.unpacked`, ...nativePath.split('/'));
if (!existsSync(unpackedNative) || readFileSync(unpackedNative).subarray(0, 4).toString('hex') === '4d5a9000') {
  throw new Error(`Invalid unpacked Darwin Canvas binary: ${unpackedNative}`);
}
console.log(`MACOS_ASAR_READY ${JSON.stringify({ arch, outputAsar, nativePath, unpacked: true, entries: entries.length })}`);
