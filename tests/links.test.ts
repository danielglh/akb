import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkDiagnostics } from '../src/core/links.js';
import { initialize, createConcept, lintBundle } from '../src/core/concept.js';

let temp: string, root: string;
const page = (body: string) => `---\ntype: Reference\n---\n${body}\n`;
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'akb-links-')); root = join(temp, 'kb');
  process.env.XDG_CACHE_HOME = join(temp, 'cache'); initialize(root, true);
  mkdirSync(join(root, 'research'));
  writeFileSync(join(root, 'research', 'index.md'), '# Research\n');
  writeFileSync(join(root, 'research', '中文 note.md'), page('Target.'));
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

it('checks inline, reference, image and root-relative paths including decoded spaces', () => {
  const content = page('[Root](/research/中文%20note.md#part)\n[Relative](../research/index.md)\n[Directory](/research/)\n[Ref][doc]\n\n[doc]: ../research/中文%20note.md\n\n![Image](missing.png)\n[Broken](missing.md)');
  const issues = linkDiagnostics(root, 'engineering/topic.md', content);
  expect(issues.map(x => x.code)).toEqual(['BROKEN_LINK', 'BROKEN_LINK']);
  expect(issues.every(x => x.severity === 'warning')).toBe(true);
});
it('ignores external URLs, same-page anchors, inline code and fenced examples', () => {
  const content = page('[Web](https://example.com/a)\n[Mail](mailto:a@example.com)\n[Part](#section)\n`[not a link](missing.md)`\n\n```md\n[Example](missing.md)\n```');
  expect(linkDiagnostics(root, 'topic.md', content)).toEqual([]);
});
it('never reads an escaped target or symlink', () => {
  writeFileSync(join(temp, 'private.txt'), 'DO_NOT_LEAK_THIS');
  symlinkSync(join(temp, 'private.txt'), join(root, 'escape.txt'));
  const issues = linkDiagnostics(root, 'topic.md', page('[Escape](../private.txt)\n[Encoded](%2e%2e/private.txt)\n[Link](escape.txt)'));
  expect(issues).toHaveLength(3);
  expect(issues.every(x => x.code === 'UNSAFE_LINK')).toBe(true);
  expect(JSON.stringify(issues)).not.toContain('DO_NOT_LEAK_THIS');
});
it('validates footnote/source attribution without mistaking definition prose for a path', () => {
  const content = '---\ntype: Reference\nsources:\n  - id: policy\n    resource: https://example.com/policy\n---\nA claim.[^policy]\n\n[^policy]: A policy description, not a filename.\n';
  expect(linkDiagnostics(root, 'topic.md', content)).toEqual([]);
  expect(linkDiagnostics(root, 'topic.md', content.replace('id: policy', 'id: different'))
    .some(x => x.code === 'FOOTNOTE_SOURCE_MISSING')).toBe(true);
});
it('checks local provenance files and reports duplicate source IDs', () => {
  const content = '---\ntype: Reference\nsources:\n  - id: duplicate\n    resource: missing-source.txt\n  - id: duplicate\n    resource: https://example.com/source\n---\nText.\n';
  expect(linkDiagnostics(root, 'topic.md', content).map(x => x.code)).toEqual(['BROKEN_LINK', 'DUPLICATE_SOURCE_ID']);
});
it('allows non-path source scope descriptors without attempting to open them', () => {
  const content = '---\ntype: Reference\nsources:\n  - resource: all queries in BigQuery project X\n---\nText.\n';
  expect(linkDiagnostics(root, 'topic.md', content)).toEqual([]);
});
it('includes navigation links in lint but broken links do not invalidate OKF', () => {
  writeFileSync(join(root, 'index.md'), '# Knowledge\n\n[Missing](missing.md)\n');
  createConcept(root, 'topic', page('[Missing](/missing.md)'));
  const result = lintBundle(root);
  expect(result.pending_checks).toEqual([]);
  expect(result.checks).toContain('markdown_links');
  expect(result.diagnostics.filter(x => x.code === 'BROKEN_LINK')).toHaveLength(2);
  expect(result.valid).toBe(true);
});
