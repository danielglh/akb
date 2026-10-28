import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { run } from '../process.js';
import { AkbError } from '../errors.js';
import { cacheRoot, hash, markdownFiles, withLock } from '../core/bundle.js';
import type { Candidate, Retriever, SearchRequest } from './interface.js';

// Targeted CLI protocol; real binary compatibility must pass the opt-in integration test.
export const QMD_VERSION = '2.8.3';
const collection = 'kb';

function context(root: string) {
  const base = join(cacheRoot(), 'qmd', hash(root).slice(0, 24));
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const configDir = join(base, 'config');
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, QMD_CONFIG_DIR: configDir, XDG_CACHE_HOME: join(base, 'cache') };
  delete env.QMD_TRUST_LOCAL_CONFIG;
  delete env.QMD_TRUST_UPDATE_HOOKS;
  return { base, configDir, env };
}

function invoke(root: string, args: string[]): string {
  const { base, env } = context(root);
  return run('qmd', ['--index', 'akb', ...args], { cwd: base, env, timeout: 30_000 });
}

function configure(root: string): void {
  markdownFiles(root);
  const version = invoke(root, ['--version']);
  if (!new RegExp(`(?:^|\\s)${QMD_VERSION.replaceAll('.', '\\.')}($|[\\s(])`).test(version.trim()))
    throw new AkbError('QMD_VERSION_UNSUPPORTED', `Install QMD ${QMD_VERSION} to use this adapter.`, 4);
  const { configDir } = context(root);
  const temp = join(configDir, `akb.${process.pid}.tmp`);
  writeFileSync(temp, stringify({ collections: { [collection]: {
    path: root, pattern: '**/*.md', includeByDefault: false,
    ignore: ['**/.*', '**/.*/**', '**/node_modules/**', '**/dist/**', '**/build/**', '**/vendor/**', '**/coverage/**', '**/index.md', '**/log.md'],
  } } }), { mode: 0o600 });
  renameSync(temp, join(configDir, 'akb.yml'));
}

export function parseQmdResults(output: string): Candidate[] {
  let rows: unknown;
  try { rows = JSON.parse(output); }
  catch { throw new AkbError('QMD_PROTOCOL_ERROR', 'QMD returned invalid JSON.', 4); }
  if (!Array.isArray(rows)) throw new AkbError('QMD_PROTOCOL_ERROR', 'QMD returned an unexpected result schema.', 4);
  const results: Candidate[] = [];
  for (const row of rows) {
    const match = row && typeof row === 'object' && typeof row.file === 'string'
      ? /^qmd:\/\/kb\/(.+\.md)(?:\?index=akb)?$/.exec(row.file) : null;
    if (!match)
      throw new AkbError('QMD_PROTOCOL_ERROR', 'QMD returned an unexpected collection or path.', 4);
    const path = match[1]!;
    results.push({ path, score: typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : null });
  }
  return results;
}

export const qmd: Retriever = {
  search({ root, query, limit }: SearchRequest): Candidate[] {
    return withLock(root, 'search', () => {
      configure(root);
      invoke(root, ['update']);
      return parseQmdResults(invoke(root, ['search', '-c', collection, '--json', '-n', String(limit), '--', query]));
    });
  },
};

export function qmdIndex(root: string, operation: 'setup' | 'refresh' | 'status') {
  return withLock(root, 'search', () => {
    configure(root);
    invoke(root, [operation === 'status' ? 'status' : 'update']);
    return { provider: 'qmd', status: operation === 'status' ? 'available' : 'refreshed', target_version: QMD_VERSION };
  });
}
