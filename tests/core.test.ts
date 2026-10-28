import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/process.js';
import { hash, conceptPath, withLock } from '../src/core/bundle.js';
import { createConcept, getConcept, updateConcept, initialize } from '../src/core/concept.js';
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
    createConcept(root, 'engineering/vacuum', content);
    const original = getConcept(root, 'engineering/vacuum');
    expect(original.content).toBe(content);
    expect(original.hash).toBe(hash(Buffer.from(content)));
    expect(original.metadata.custom).toEqual({ preserved: true });
    expect(original.metadata.status).toBe('stable');
    const updated = content + 'Additional evidence.\n';
    updateConcept(root, 'engineering/vacuum', updated, original.hash);
    expect(() => updateConcept(root, 'engineering/vacuum', content, original.hash)).toThrow(/changed/);
    expect(getConcept(root, 'engineering/vacuum').content).toBe(updated);
    expect(git(root, ['status', '--porcelain'])).toContain('??');
  });
  it('never overwrites on create and dry-run does not write', () => {
    createConcept(root, 'vacuum', content);
    expect(() => createConcept(root, 'vacuum', '---\ntype: Other\n---\n')).toThrow(/exists/);
    const original = getConcept(root, 'vacuum');
    const preview = updateConcept(root, 'vacuum', content + 'Change.\n', original.hash, true);
    expect(preview.diff).toContain('+Change.');
    expect(getConcept(root, 'vacuum').hash).toBe(original.hash);
    createConcept(root, 'new/topic', content, true);
    expect(() => getConcept(root, 'new/topic')).toThrow();
  });
  it('rejects malformed content without changing original bytes', () => {
    createConcept(root, 'vacuum', content);
    expect(() => updateConcept(root, 'vacuum', 'no frontmatter', hash(content))).toThrow(/Frontmatter/);
    expect(readFileSync(join(root, 'vacuum.md'), 'utf8')).toBe(content);
    expect(inspectMarkdown('---\ntype: [broken\n---\n').some(x => x.severity === 'error')).toBe(true);
    expect(inspectMarkdown('---\ntype: Unknown Type\n---\n').every(x => x.severity === 'warning')).toBe(true);
  });
  it('rejects duplicate YAML keys and unsafe alias expansion', () => {
    expect(inspectMarkdown('---\ntype: A\ntype: B\n---\n').some(x => x.severity === 'error')).toBe(true);
  });
});

describe('write boundaries', () => {
  it.each(['../escape', '/absolute', '.git/config', 'index', 'log', 'a/../../escape', 'a\\escape', 'a/./b', 'a//b'])(
    'rejects %s', id => expect(() => conceptPath(root, id)).toThrow());
  it('rejects symlink paths and filename case collisions', () => {
    mkdirSync(join(temp, 'outside'));
    symlinkSync(join(temp, 'outside'), join(root, 'linked'));
    expect(() => createConcept(root, 'linked/topic', content)).toThrow(/Symbolic/);
    writeFileSync(join(root, 'Existing.md'), content);
    expect(() => createConcept(root, 'existing', content)).toThrow(/casing/);
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
