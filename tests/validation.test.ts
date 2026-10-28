import { expect, it } from 'vitest';
import { checkedPage, datetime, inspectMarkdown, reservedDiagnostics } from '../src/core/validation.js';
import { run } from '../src/process.js';

it('normalizes single verifier mappings without modifying original content', () => {
  const text = '---\ntype: Custom\nverified: {by: "human:tester", at: "2026-10-01T00:00:00Z"}\n---\nText.';
  expect(checkedPage(text, 'test.md').metadata.verified).toEqual([{ by: 'human:tester', at: '2026-10-01T00:00:00Z' }]);
});
it('requires real timezone-aware calendar dates and marks expiry at the deadline', () => {
  expect(datetime('2026-02-30T00:00:00Z')).toBe(false);
  expect(datetime('2026-10-26T00:00:00')).toBe(false);
  expect(datetime('2026-10-26T08:00:00+08:00')).toBe(true);
  expect(inspectMarkdown('---\ntype: Custom\nstale_after: 2026-10-26T00:00:00Z\n---\n', '', Date.parse('2026-10-26T00:00:00Z'))
    .some(x => x.code === 'STALE' && x.severity === 'warning')).toBe(true);
});
it('reports optional field shapes as warnings, not minimum compliance errors', () => {
  expect(inspectMarkdown('---\ntype: Custom\nsources: [invalid]\nverified: 5\n---\n')
    .filter(x => ['INVALID_SOURCES', 'INVALID_VERIFIED'].includes(x.code)).every(x => x.severity === 'warning')).toBe(true);
  expect(reservedDiagnostics('---\ntype: Reference\n---\n', 'sub/index.md')[0]?.severity).toBe('error');
});
it('warns when generation or verification identities do not use the OKF actor convention', () => {
  const invalid = '---\ntype: Reference\ngenerated: {by: "a descriptive agent label", at: "2026-10-26T00:00:00Z"}\nverified: {by: "human:", at: "2026-10-26T00:00:00Z"}\n---\n';
  expect(inspectMarkdown(invalid).filter(x => x.code === 'INVALID_ACTOR')).toHaveLength(2);
  expect(inspectMarkdown(invalid.replace('a descriptive agent label', 'codex/model-unknown').replace('"human:"', '"human:reviewer"'))
    .some(x => x.code === 'INVALID_ACTOR')).toBe(false);
});
it('bounds alias expansion', () => {
  const text = '---\ntype: Reference\na: &a [a,a,a,a,a,a,a,a,a,a]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\n---\n';
  expect(inspectMarkdown(text).some(x => x.code === 'INVALID_YAML')).toBe(true);
});
it('fails explicitly for missing executables and bounded child timeouts', () => {
  expect(() => run('akb-nonexistent-test-executable', [])).toThrow(/could not run/);
  expect(() => run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 20 })).toThrow(/could not run/);
});
