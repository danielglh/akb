import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

let temp: string, root: string, env: NodeJS.ProcessEnv;
const cli = resolve('dist/cli.js');
function invoke(args: string[], exitCode = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, '--format', 'json'], { env, encoding: 'utf8', timeout: 15_000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(exitCode);
  const response = JSON.parse(result.stdout);
  expect(response.schema_version).toBe(1);
  return response;
}
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'akb-cli-')); root = join(temp, 'kb');
  env = { ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), XDG_CACHE_HOME: join(temp, 'cache') };
  invoke(['init', root, '--git']); invoke(['add', 'personal', root]);
  const path = join(temp, 'config', 'akb', 'config.yaml');
  const config = parse(readFileSync(path, 'utf8'));
  config.retrieval = { provider: 'ripgrep', fallback: 'none' };
  writeFileSync(path, stringify(config));
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

it('executes init → create → read → dry-run/update → lint → search → unregister', () => {
  const input = join(temp, 'input.md');
  const original = '---\ntype: Reference\ntitle: Vacuum\n---\nPostgres vacuum replication.\n';
  writeFileSync(input, original);
  invoke(['create', '--path', 'database/vacuum', '--from-file', input]);
  const read = invoke(['get', 'database/vacuum']);
  expect(read.content).toBe(original);
  expect(read.hash).toMatch(/^[a-f0-9]{64}$/);
  writeFileSync(input, original + 'New replication evidence.\n');
  const args = ['update', '--path', 'database/vacuum', '--from-file', input, '--expect-hash', read.hash];
  expect(invoke([...args, '--dry-run']).diff).toContain('+New replication evidence.');
  expect(invoke(['get', 'database/vacuum']).hash).toBe(read.hash);
  const updated = invoke(args);
  expect(updated.hash).not.toBe(read.hash);
  expect(invoke(args, 5).error.code).toBe('HASH_CONFLICT');
  expect(invoke(['lint']).valid).toBe(true);
  expect(invoke(['lint']).pending_checks).toEqual([]);
  expect(invoke(['search', 'replication']).results[0].path).toBe('database/vacuum.md');
  expect(invoke(['search', 'replication', '--kb', 'wrong'], 2).error.code).toBe('UNKNOWN_KB');
  expect(invoke(['info']).name).toBe('personal');
  expect(invoke(['search-index', 'status']).status).toBe('not_required');
  invoke(['remove', 'personal']);
  expect(existsSync(join(root, 'database', 'vacuum.md'))).toBe(true);
  expect(invoke(['get', 'database/vacuum'], 2).error.code).toBe('UNKNOWN_KB');
});
it('rejects malformed CLI input with structured errors', () => {
  expect(invoke(['update', '--path', 'test', '--from-file', 'missing'], 2).error.code).toBe('INVALID_ARGUMENT');
  expect(invoke(['search', 'word', '--mode', 'hybrid'], 2).error.code).toBe('UNSUPPORTED_MODE');
  expect(invoke(['get', '../private'], 6).error.code).toBe('UNSAFE_PATH');
  expect(invoke(['add', 'other', root], 2).error.code).toBe('KB_ALREADY_REGISTERED');
});
