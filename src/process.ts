import { spawnSync } from 'node:child_process';
import { AkbError } from './errors.js';

export function run(command: string, args: string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; input?: string; accept?: number[]; timeout?: number;
} = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout ?? 15_000,
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new AkbError(code === 'ENOENT' ? 'DEPENDENCY_MISSING' : code === 'ETIMEDOUT' ? 'DEPENDENCY_TIMEOUT' : 'DEPENDENCY_FAILED',
      `${command} could not run. Check installation, runtime compatibility and permissions.`, 4);
  }
  if (!(options.accept ?? [0]).includes(result.status ?? -1)) {
    throw new AkbError('DEPENDENCY_FAILED', `${command} failed. Inspect the selected tool configuration.`, 4);
  }
  return result.stdout;
}

export function git(root: string, args: string[], accept?: number[]): string {
  return run('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { accept });
}
