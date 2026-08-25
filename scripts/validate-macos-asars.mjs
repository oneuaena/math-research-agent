import { extractFile, listPackage, statFile } from '@electron/asar';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
for (const arch of ['arm64', 'x64']) {
  const releaseDirectory = process.env.MRA_RELEASE_DIR ? resolve(process.env.MRA_RELEASE_DIR) : join(root, 'release');
  const archive = join(releaseDirectory, 'mac-asars', arch, 'app.asar');
  const runtime = extractFile(archive, 'dist-electron\\electron\\python-runtime.js').toString('utf8');
  const native = `node_modules\\@napi-rs\\canvas-darwin-${arch}\\skia.darwin-${arch}.node`;
  if (!runtime.includes("platform === 'darwin'") || !runtime.includes("'python3.12'")) {
    throw new Error(`${arch} Darwin Python runtime branch is missing.`);
  }
  if (!statFile(archive, native).unpacked) throw new Error(`${arch} Canvas native module is not unpacked.`);
  if (listPackage(archive).some((entry) => entry.includes('canvas-win32'))) {
    throw new Error(`${arch} app.asar contains a Windows Canvas package.`);
  }
  console.log(`PACKAGED_ASAR_OK ${arch}`);
}
