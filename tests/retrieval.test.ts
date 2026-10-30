import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize, createConcept, getConcept, updateConcept } from '../src/core/concept.js';
import { search } from '../src/retrieval/search.js';
import { ripgrep } from '../src/retrieval/ripgrep.js';
import { parseQmdResults, qmdIndex } from '../src/retrieval/qmd.js';
import { AkbError } from '../src/errors.js';
import type { Config } from '../src/config.js';
import { run } from '../src/process.js';

let temp: string, root: string;
const rgConfig: Config = { version: 2, knowledge_bases: [], retrieval: { provider: 'ripgrep', fallback: 'none' } };
const qmdConfig: Config = { version: 2, knowledge_bases: [], retrieval: { provider: 'qmd', fallback: 'ripgrep' } };
function page(body: string, title = 'Reference') { return `---\ntype: Reference\ntitle: ${title}\n---\n${body}\n`; }
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'akb-search-')); root = join(temp, 'kb');
  process.env.XDG_CACHE_HOME = join(temp, 'cache'); initialize(root, true);
  createConcept(root, 'knowledge/database/vacuum', page('Postgres VACUUM affects replication lag.\nCheck replication health.', '数据库维护'));
  createConcept(root, 'knowledge/other', page('Postgres memory tuning.'));
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

it('runs real rg, requires all terms, returns current body and line numbers', () => {
  const result = search(root, 'personal', rgConfig, 'vacuum REPLICATION');
  expect(result.results.map(x => x.path)).toEqual(['knowledge/database/vacuum.md']);
  expect(result.results[0]).toMatchObject({ title: '数据库维护', score: null, status: 'stable', line: 5 });
  expect(result.degraded).toBe(false);
  expect(search(root, 'personal', rgConfig, 'VACUUM memory').results).toEqual([]);
  expect(search(root, 'personal', rgConfig, '不存在').results).toEqual([]);
});

it('excludes repository prose from rg and filters stale out-of-scope provider candidates', () => {
  mkdirSync(join(root, 'knowledge'), { recursive: true });
  writeFileSync(join(root, 'knowledge/scoped.md'), page('contentscopeprobe knowledge.'));
  for (const file of ['README.md', 'INSTALL.md', 'AGENTS.md'])
    writeFileSync(join(root, file), '# Instructions\ncontentscopeprobe docsonlyprobe\n');
  expect(search(root, 'personal', rgConfig, 'contentscopeprobe', 1).results.map(row => row.path)).toEqual(['knowledge/scoped.md']);
  expect(search(root, 'personal', rgConfig, 'docsonlyprobe').results).toEqual([]);
  const stale = { search: () => [{ path: 'README.md', score: 1 }, { path: 'knowledge/scoped.md', score: 0.8 }] };
  expect(search(root, 'personal', qmdConfig, 'contentscopeprobe', 2, 'keyword', { qmd: stale, ripgrep }).results.map(row => row.path))
    .toEqual(['knowledge/scoped.md']);
});
it('treats shell metacharacters and regex as literal query data', () => {
  createConcept(root, 'knowledge/special', page('Exact [a-z] $(touch NEVER) --help 中文。'));
  expect(search(root, 'personal', rgConfig, '[a-z]').results.map(x => x.path)).toEqual(['knowledge/special.md']);
  expect(search(root, 'personal', rgConfig, '$(touch NEVER)').results.map(x => x.path)).toEqual(['knowledge/special.md']);
  expect(search(root, 'personal', rgConfig, '--help').results.map(x => x.path)).toEqual(['knowledge/special.md']);
  expect(search(root, 'personal', rgConfig, '中文').results.map(x => x.path)).toEqual(['knowledge/special.md']);
});
it('returns newly updated content and deterministic ordering', () => {
  const old = getConcept(root, 'knowledge/other');
  updateConcept(root, 'knowledge/other', page('Postgres VACUUM replication.\nReplication.\nVACUUM.', 'Updated'), old.hash);
  const results = search(root, 'personal', rgConfig, 'vacuum replication').results;
  expect(results.map(x => x.path)).toEqual(['knowledge/other.md', 'knowledge/database/vacuum.md']);
  expect(results[0]!.title).toBe('Updated');
});
it('marks QMD dependency failures as an explicit keyword fallback', () => {
  const failed = { search: () => { throw new AkbError('DEPENDENCY_MISSING', 'not installed', 4); } };
  const result = search(root, 'personal', qmdConfig, 'vacuum', 10, 'keyword', { qmd: failed, ripgrep });
  expect(result).toMatchObject({ provider: 'ripgrep', requested_provider: 'qmd', degraded: true, degradation_reason: 'DEPENDENCY_MISSING' });
  expect(result.results).toHaveLength(1);
  expect(() => search(root, 'personal', { ...qmdConfig, retrieval: { provider: 'qmd', fallback: 'none' } }, 'vacuum', 10, 'keyword', { qmd: failed, ripgrep })).toThrow(/not installed/);
});
it('falls back with the actual QMD executable absent, and fails if rg is also absent', () => {
  const rgPath = run('which', ['rg']).trim();
  const bin = join(temp, 'only-rg'); mkdirSync(bin); symlinkSync(rgPath, join(bin, 'rg'));
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = bin;
    expect(search(root, 'personal', qmdConfig, 'vacuum')).toMatchObject({
      provider: 'ripgrep', degraded: true, degradation_reason: 'DEPENDENCY_MISSING',
    });
    unlinkSync(join(bin, 'rg'));
    expect(() => search(root, 'personal', qmdConfig, 'vacuum')).toThrow(/rg could not run/);
  } finally { process.env.PATH = originalPath; }
});
it('does not fallback for invalid requests or unsafe paths', () => {
  expect(() => search(root, 'personal', qmdConfig, 'vacuum', 10, 'hybrid')).toThrow(/Only keyword/);
  expect(() => search(root, 'personal', qmdConfig, '   ')).toThrow(/Query/);
  expect(() => search(root, 'personal', qmdConfig, 'vacuum', 0)).toThrow(/Limit/);
  const unsafe = { search: () => [{ path: '../private.md', score: 1 }] };
  expect(() => search(root, 'personal', qmdConfig, 'vacuum', 10, 'keyword', { qmd: unsafe, ripgrep })).toThrow(/Bundle-relative/);
});
it('reads QMD candidate metadata and snippets from disk, never cached prose', () => {
  const adapter = { search: () => parseQmdResults(JSON.stringify([
    { file: 'qmd://kb/knowledge/database/vacuum.md', score: 0.7, snippet: 'OLD SECRET', title: 'OLD' },
    { file: 'qmd://kb/knowledge/deleted.md', score: 0.5 },
  ])) };
  const result = search(root, 'personal', qmdConfig, 'vacuum', 10, 'keyword', { qmd: adapter, ripgrep });
  expect(result.results).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain('OLD');
  expect(result.results[0]!.score).toBe(0.7);
});
it('rejects unexpected QMD schemas and collections', () => {
  expect(() => parseQmdResults('not json')).toThrow(/JSON/);
  expect(() => parseQmdResults('{}')).toThrow(/schema/);
  expect(() => parseQmdResults('[{"file":"qmd://personal/private.md"}]')).toThrow(/collection/);
  expect(parseQmdResults('[{"file":"qmd://kb/knowledge/database/vacuum.md?index=akb","score":0.7}]'))
    .toEqual([{ path: 'knowledge/database/vacuum.md', score: 0.7 }]);
  expect(() => parseQmdResults('[{"file":"qmd://kb/topic.md?index=other"}]')).toThrow(/collection/);
});

describe.skipIf(!process.env.AKB_TEST_QMD)('real QMD 2.8.3 (opt in)', () => {
  it('indexes both content directories but excludes instructions before applying the result limit', () => {
    mkdirSync(join(root, 'knowledge'), { recursive: true });
    mkdirSync(join(root, 'source'), { recursive: true });
    writeFileSync(join(root, 'knowledge/scoped.md'), page('contentscopeprobe knowledge.'));
    writeFileSync(join(root, 'source/scoped.md'), page('contentscopeprobe source.'));
    for (const file of ['README.md', 'INSTALL.md', 'AGENTS.md'])
      writeFileSync(join(root, file), '# Instructions\n' + 'contentscopeprobe docsonlyprobe\n'.repeat(10));
    const config: Config = { version: 2, knowledge_bases: [], retrieval: { provider: 'qmd', fallback: 'none' } };
    const result = search(root, 'personal', config, 'contentscopeprobe');
    expect(result.provider).toBe('qmd');
    expect(result.degraded).toBe(false);
    expect(result.results.map(row => row.path).sort()).toEqual(['knowledge/scoped.md', 'source/scoped.md']);
    expect(search(root, 'personal', config, 'contentscopeprobe', 1).results).toHaveLength(1);
    expect(search(root, 'personal', config, 'docsonlyprobe').results).toEqual([]);
  }, 60_000);
  it('keeps QMD and rg results isolated between KB roots with identical Concept paths', () => {
    const other = initialize(join(temp, 'second-kb'), true).path;
    createConcept(root, 'knowledge/shared', page('scopeprobe firstonly'));
    createConcept(other, 'knowledge/shared', page('scopeprobe secondonly'));
    const config: Config = { version: 2, knowledge_bases: [], retrieval: { provider: 'qmd', fallback: 'none' } };
    for (const provider of ['qmd', 'ripgrep'] as const) {
      const scoped = { ...config, retrieval: { provider, fallback: 'none' as const } };
      for (const [path, name, own, foreign] of [[root, 'first', 'firstonly', 'secondonly'], [other, 'second', 'secondonly', 'firstonly']]) {
        const found = search(path!, name!, scoped, 'scopeprobe');
        expect(found.provider).toBe(provider);
        expect(found.degraded).toBe(false);
        expect(found.scope).toEqual([name]);
        expect(found.results).toHaveLength(1);
        expect(found.results[0]!.snippet).toContain(own);
        expect(found.results[0]!.snippet).not.toContain(foreign);
        expect(search(path!, name!, scoped, foreign!).results).toEqual([]);
      }
    }
  }, 60_000);
  it('indexes and searches actual files through the isolated adapter', () => {
    qmdIndex(root, 'setup');
    const config: Config = { version: 2, knowledge_bases: [], retrieval: { provider: 'qmd', fallback: 'none' } };
    const result = search(root, 'personal', config, 'vacuum');
    expect(result.provider).toBe('qmd');
    expect(result.results.some(x => x.path === 'knowledge/database/vacuum.md')).toBe(true);
  }, 60_000);
  it('refreshes external edits and deletions, returns empty hits and supports mixed-language terms', () => {
    const config: Config = { version: 2, knowledge_bases: [], retrieval: { provider: 'qmd', fallback: 'none' } };
    expect(search(root, 'personal', config, 'vacuum').results).toHaveLength(1);
    writeFileSync(join(root, 'knowledge', 'database', 'vacuum.md'), page('数据库 VACUUM replication freshmarker.', '新标题'));
    const updated = search(root, 'personal', config, 'freshmarker').results;
    expect(updated[0]).toMatchObject({ path: 'knowledge/database/vacuum.md', title: '新标题' });
    expect(updated[0]!.snippet).toContain('数据库');
    expect(search(root, 'personal', config, '数据库 VACUUM').results[0]!.path).toBe('knowledge/database/vacuum.md');
    expect(search(root, 'personal', config, 'nonexistentuniqueterm').results).toEqual([]);
    unlinkSync(join(root, 'knowledge', 'database', 'vacuum.md'));
    expect(search(root, 'personal', config, 'freshmarker').results).toEqual([]);
  }, 60_000);
  it('returns literal Unicode, space, case and punctuation filenames', () => {
    const id = 'knowledge/research/中文 UPPER note%20#question?';
    createConcept(root, id, page('uniquepathmarker confirms the original filename.'));
    const config: Config = { version: 2, knowledge_bases: [], retrieval: { provider: 'qmd', fallback: 'none' } };
    expect(search(root, 'personal', config, 'uniquepathmarker').results[0]!.path).toBe(`${id}.md`);
  }, 60_000);
});
