import { join } from 'node:path';

export interface PythonRuntimeResolution {
  source: 'bundled' | 'configured';
  executable: string;
  argsPrefix: string[];
  displayPath: string;
}

export function resolvePythonRuntime(input: {
  packaged: boolean;
  resourcesPath: string;
  configuredPath: string;
  platform?: NodeJS.Platform;
}): PythonRuntimeResolution {
  if (input.packaged) {
    const platform = input.platform ?? process.platform;
    const executableParts = platform === 'win32' ? ['python.exe'] : platform === 'darwin' ? ['bin', 'python3.12'] : ['bin', 'python3'];
    return {
      source: 'bundled',
      executable: join(input.resourcesPath, 'runtime', 'python', ...executableParts),
      argsPrefix: [],
      displayPath: `resources/runtime/python/${executableParts.join('/')}`,
    };
  }
  const configured = input.configuredPath.trim() || 'python';
  const launcher = configured.match(/^(py(?:\.exe)?)\s+(-\d+(?:\.\d+)?)$/i);
  return {
    source: 'configured',
    executable: launcher?.[1] ?? configured,
    argsPrefix: launcher ? [launcher[2]] : [],
    displayPath: configured,
  };
}
