import { join } from 'node:path';

export interface PythonRuntimeResolution {
  source: 'bundled' | 'configured';
  executable: string;
  displayPath: string;
}

export function resolvePythonRuntime(input: {
  packaged: boolean;
  resourcesPath: string;
  configuredPath: string;
  platform?: NodeJS.Platform;
}): PythonRuntimeResolution {
  if (input.packaged) {
    const executableName = (input.platform ?? process.platform) === 'win32' ? 'python.exe' : 'python';
    return {
      source: 'bundled',
      executable: join(input.resourcesPath, 'runtime', 'python', executableName),
      displayPath: `resources/runtime/python/${executableName}`,
    };
  }
  return {
    source: 'configured',
    executable: input.configuredPath.trim() || 'python',
    displayPath: input.configuredPath.trim() || 'python',
  };
}
