import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

let temp: string, root: string, env: NodeJS.ProcessEnv;
const cli = resolve('dist/cli.js');
function invoke(args: string[], exitCode = 0, selectKb = true) {
  const scope = selectKb && !args.includes('--kb') && ['info', 'get', 'create', 'update', 'search', 'lint', 'search-index'].includes(args[0]!) ? ['--kb', 'personal'] : [];
  const result = spawnSync(process.execPath, [cli, ...scope, ...args, '--format', 'json'], { env, encoding: 'utf8', timeout: 15_000 });
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
  expect(invoke(['add', 'personal', root], 2).error.code).toBe('KB_ALREADY_REGISTERED');
});

it('requires an explicit registered KB even when only one exists', () => {
  for (const args of [['info'], ['get', 'topic'], ['search', 'word'], ['lint'], ['search-index', 'status'],
    ['create', '--path', 'topic', '--from-file', '/missing'],
    ['update', '--path', 'topic', '--from-file', '/missing', '--expect-hash', 'a'.repeat(64)]]) {
    expect(invoke(args, 2, false).error.code).toBe('KB_REQUIRED');
    expect(invoke([...args, '--kb', 'missing'], 2).error.code).toBe('UNKNOWN_KB');
  }
});

it('keeps reads, writes, hashes and search results scoped to the named KB', () => {
  const other = join(temp, 'work');
  invoke(['init', other, '--git']);
  invoke(['add', 'work', other]);
  expect(invoke(['list']).knowledge_bases.map((kb: { name: string }) => kb.name)).toEqual(['personal', 'work']);
  const input = join(temp, 'input.md');
  for (const name of ['personal', 'work']) {
    writeFileSync(input, `---\ntype: Reference\n---\nsharedmarker ${name}marker\n`);
    invoke(['create', '--kb', name, '--path', 'topic', '--from-file', input]);
  }
  const personal = invoke(['get', 'topic']);
  const work = invoke(['get', 'topic', '--kb', 'work']);
  expect(work.hash).not.toBe(personal.hash);
  expect(work.content).not.toContain('personalmarker');
  writeFileSync(input, work.content + 'updatedmarker\n');
  expect(invoke(['update', '--kb', 'work', '--path', 'topic', '--from-file', input, '--expect-hash', personal.hash], 5).error.code).toBe('HASH_CONFLICT');
  invoke(['update', '--kb', 'work', '--path', 'topic', '--from-file', input, '--expect-hash', work.hash]);
  expect(invoke(['get', 'topic']).hash).toBe(personal.hash);
  for (const name of ['personal', 'work']) {
    const result = invoke(['search', 'sharedmarker', '--kb', name]);
    expect(result.scope).toEqual([name]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].kb).toBe(name);
    expect(result.results[0].snippet).toContain(`${name}marker`);
    expect(invoke(['lint', '--kb', name]).valid).toBe(true);
  }
  expect(invoke(['search', 'updatedmarker']).results).toEqual([]);
  invoke(['remove', 'personal']);
  expect(invoke(['info', '--kb', 'work']).name).toBe('work');
  expect(existsSync(join(root, 'topic.md'))).toBe(true);
  expect(invoke(['get', 'topic'], 2).error.code).toBe('UNKNOWN_KB');
});
