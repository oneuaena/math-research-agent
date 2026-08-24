import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolvePythonRuntime } from './python-runtime';

describe('Python runtime resolution', () => {
  it('uses the asar-external bundled executable for packaged Windows builds', () => {
    const runtime = resolvePythonRuntime({ packaged: true, resourcesPath: 'C:\\Program Files\\Math Research Agent\\resources', configuredPath: 'python', platform: 'win32' });
    expect(runtime.source).toBe('bundled');
    expect(runtime.executable).toBe(join('C:\\Program Files\\Math Research Agent\\resources', 'runtime', 'python', 'python.exe'));
    expect(runtime.argsPrefix).toEqual([]);
    expect(runtime.displayPath).toBe('resources/runtime/python/python.exe');
  });

  it('uses the architecture-specific bundled executable inside a packaged macOS app', () => {
    const runtime = resolvePythonRuntime({ packaged: true, resourcesPath: '/Applications/Math Research Agent.app/Contents/Resources', configuredPath: 'python3', platform: 'darwin' });
    expect(runtime).toMatchObject({
      source: 'bundled',
      executable: join('/Applications/Math Research Agent.app/Contents/Resources', 'runtime', 'python', 'bin', 'python3.12'),
      displayPath: 'resources/runtime/python/bin/python3.12',
    });
  });

  it('uses the configured interpreter only in development', () => {
    expect(resolvePythonRuntime({ packaged: false, resourcesPath: '', configuredPath: 'py -3.12', platform: 'win32' })).toMatchObject({ source: 'configured', executable: 'py', argsPrefix: ['-3.12'] });
  });
});
