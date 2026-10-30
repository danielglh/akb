import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/process.js';
import { hash, conceptPath, withLock } from '../src/core/bundle.js';
import { createConcept, getConcept, updateConcept, initialize, lintBundle } from '../src/core/concept.js';
import { inspectMarkdown } from '../src/core/validation.js';

let temp: string, root: string;
const content = '---\ntype: Reference\ntitle: 数据库\ncustom:\n  preserved: true\n---\n# 数据库\nPostgres vacuum replication lag.\n';
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'akb-test-'));
  root = join(temp, 'kb');
  process.env.XDG_CACHE_HOME = join(temp, 'cache');
  initialize(root, true);
});
afterEach(() => { rmSync(temp, { recursive: true, force: true }); });

describe('OKF file operations', () => {
  it('round-trips bytes and unknown fields, updates only the expected version', () => {
    createConcept(root, 'knowledge/engineering/vacuum', content);
    const original = getConcept(root, 'knowledge/engineering/vacuum');
    expect(original.content).toBe(content);
    expect(original.hash).toBe(hash(Buffer.from(content)));
    expect(original.metadata.custom).toEqual({ preserved: true });
    expect(original.metadata.status).toBe('stable');
    const updated = content + 'Additional evidence.\n';
    updateConcept(root, 'knowledge/engineering/vacuum', updated, original.hash);
    expect(() => updateConcept(root, 'knowledge/engineering/vacuum', content, original.hash)).toThrow(/changed/);
    expect(getConcept(root, 'knowledge/engineering/vacuum').content).toBe(updated);
    expect(git(root, ['status', '--porcelain'])).toContain('??');
  });
  it('never overwrites on create and dry-run does not write', () => {
    createConcept(root, 'knowledge/vacuum', content);
    expect(() => createConcept(root, 'knowledge/vacuum', '---\ntype: Other\n---\n')).toThrow(/exists/);
    const original = getConcept(root, 'knowledge/vacuum');
    const preview = updateConcept(root, 'knowledge/vacuum', content + 'Change.\n', original.hash, true);
    expect(preview.diff).toContain('+Change.');
    expect(getConcept(root, 'knowledge/vacuum').hash).toBe(original.hash);
    createConcept(root, 'knowledge/new/topic', content, true);
    expect(() => getConcept(root, 'knowledge/new/topic')).toThrow();
  });
  it('rejects malformed content without changing original bytes', () => {
    createConcept(root, 'knowledge/vacuum', content);
    expect(() => updateConcept(root, 'knowledge/vacuum', 'no frontmatter', hash(content))).toThrow(/Frontmatter/);
    expect(readFileSync(join(root, 'knowledge', 'vacuum.md'), 'utf8')).toBe(content);
    expect(inspectMarkdown('---\ntype: [broken\n---\n').some(x => x.severity === 'error')).toBe(true);
    expect(inspectMarkdown('---\ntype: Unknown Type\n---\n').every(x => x.severity === 'warning')).toBe(true);
  });
  it('rejects duplicate YAML keys and unsafe alias expansion', () => {
    expect(inspectMarkdown('---\ntype: A\ntype: B\n---\n').some(x => x.severity === 'error')).toBe(true);
  });
});

describe('write boundaries', () => {
  it('creates the fixed content directories and never reads or overwrites repository docs as Concepts', () => {
    for (const dir of ['knowledge', 'source']) expect(existsSync(join(root, dir))).toBe(true);
    const trackable = git(root, ['ls-files', '--others', '--exclude-standard']);
    for (const dir of ['knowledge', 'source']) expect(trackable).toContain(`${dir}/index.md`);
    const prose = '# Repository instructions\n';
    writeFileSync(join(root, 'README.md'), prose);
    expect(() => getConcept(root, 'README')).toThrow(/Bundle-relative/);
    expect(() => createConcept(root, 'README', content)).toThrow(/Bundle-relative/);
    expect(() => updateConcept(root, 'README', content, hash(prose))).toThrow(/Bundle-relative/);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(prose);
  });
  it('reports a legacy layout instead of silently linting no knowledge', () => {
    for (const dir of ['knowledge', 'source']) rmSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'legacy.md'), content);
    expect(() => lintBundle(root)).toThrow(/knowledge\/ or source\//);
    expect(readFileSync(join(root, 'legacy.md'), 'utf8')).toBe(content);
    mkdirSync(join(root, 'knowledge'));
    mkdirSync(join(root, 'source-text'));
    writeFileSync(join(root, 'source-text', 'legacy.md'), content);
    expect(() => lintBundle(root)).toThrow(/Rename legacy source-text/);
    expect(readFileSync(join(root, 'source-text', 'legacy.md'), 'utf8')).toBe(content);
  });
  it('refuses initialization when a content directory name is occupied by a file', () => {
    rmSync(join(root, 'index.md'));
    rmSync(join(root, 'knowledge'), { recursive: true });
    writeFileSync(join(root, 'knowledge'), 'preserve me');
    expect(() => initialize(root, false)).toThrow(/knowledge must be a directory/);
    expect(existsSync(join(root, 'index.md'))).toBe(false);
    expect(readFileSync(join(root, 'knowledge'), 'utf8')).toBe('preserve me');
  });
  it.each(['../escape', '/absolute', '.git/config', 'index', 'log', 'a/../../escape', 'a\\escape', 'a/./b', 'a//b'])(
    'rejects %s', id => expect(() => conceptPath(root, id)).toThrow());
  it('rejects symlink paths and filename case collisions', () => {
    mkdirSync(join(temp, 'outside'));
    symlinkSync(join(temp, 'outside'), join(root, 'knowledge', 'linked'));
    expect(() => createConcept(root, 'knowledge/linked/topic', content)).toThrow(/Symbolic/);
    writeFileSync(join(root, 'knowledge', 'Existing.md'), content);
    expect(() => createConcept(root, 'knowledge/existing', content)).toThrow(/casing/);
  });
  it('coordinates AKB writers with an exclusive lock', () => {
    withLock(root, 'write', () => expect(() => withLock(root, 'write', () => {})).toThrow(/lock/));
    expect(withLock(root, 'write', () => 42)).toBe(42);
  });
  it('refuses initialization over an existing index', () => {
    expect(() => initialize(root, false)).toThrow(/exists/);
    expect(readFileSync(join(root, 'index.md'), 'utf8')).toContain('okf_version');
  });
});
