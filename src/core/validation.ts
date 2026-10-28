import { parseDocument } from 'yaml';
import { AkbError } from '../errors.js';

export interface Diagnostic { code: string; severity: 'error' | 'warning'; path: string; message: string }
export interface ParsedPage { metadata: Record<string, unknown>; body: string; bodyLine: number }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const actor = (value: unknown): boolean => typeof value === 'string' && /^(?:(?:human|process):[^\s]+|[^/\s]+\/[^/\s]+)$/u.test(value);
export const datetime = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);

export function parsePage(content: string): ParsedPage {
  const front = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!front) throw new AkbError('INVALID_FRONTMATTER', 'Frontmatter must be a YAML block at the start of the file.', 3);
  try {
    const doc = parseDocument(front[1]!, { uniqueKeys: true });
    if (doc.errors.length) throw new Error();
    const metadata: unknown = doc.toJS({ maxAliasCount: 50 });
    if (!record(metadata)) throw new Error();
    return { metadata, body: content.slice(front[0].length), bodyLine: front[0].split('\n').length };
  } catch { throw new AkbError('INVALID_YAML', 'Frontmatter must be a YAML mapping without duplicate keys or excessive aliases.', 3); }
}

export function inspectMarkdown(content: string, path = '', now = Date.now()): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const issue = (code: string, message: string, severity: 'error' | 'warning' = 'warning') => issues.push({ code, message, severity, path });
  let m: Record<string, unknown>;
  try { m = parsePage(content).metadata; }
  catch (error) { const e = error as AkbError; issue(e.code, e.message, 'error'); return issues; }
  if (typeof m.type !== 'string' || !m.type.trim()) issue('TYPE_REQUIRED', 'Concept requires a non-empty string type.', 'error');
  for (const key of ['title', 'description', 'tags', 'status', 'sources'])
    if (m[key] === undefined) issue('RECOMMENDED_FIELD', `Recommended field is missing: ${key}.`);
  for (const key of ['title', 'description'])
    if (m[key] !== undefined && typeof m[key] !== 'string') issue('FIELD_SHAPE', `${key} should be a string.`);
  if (m.tags !== undefined && (!Array.isArray(m.tags) || !m.tags.every(x => typeof x === 'string')))
    issue('FIELD_SHAPE', 'tags should be an array of strings.');
  if (m.status !== undefined && !['draft', 'stable', 'deprecated'].includes(m.status as string)) issue('INVALID_STATUS', 'Unknown lifecycle status.');
  if (m.status === 'deprecated') issue('DEPRECATED', 'Concept is deprecated; retain it for history and links.');
  if (m.stale_after !== undefined) {
    if (!datetime(m.stale_after)) issue('INVALID_TIMESTAMP', 'stale_after should be an ISO datetime with explicit timezone.');
    else if (now >= Date.parse(m.stale_after)) issue('STALE', 'Concept is due for re-verification; this does not imply it is incorrect.');
  }
  if (m.sources !== undefined && (!Array.isArray(m.sources) || m.sources.some(x => !record(x) || typeof x.resource !== 'string' || !x.resource.trim())))
    issue('INVALID_SOURCES', 'Each sources entry should include a non-empty resource.');
  if (m.generated !== undefined && (!record(m.generated) || typeof m.generated.by !== 'string' || !datetime(m.generated.at)))
    issue('INVALID_GENERATED', 'generated should contain by and at.');
  if (record(m.generated) && !actor(m.generated.by)) issue('INVALID_ACTOR', 'generated.by should use producer/version, human:id or process:id.');
  if (m.verified !== undefined) {
    const verifiers = Array.isArray(m.verified) ? m.verified : [m.verified];
    if (!verifiers.length || verifiers.some(v => !record(v) || typeof v.by !== 'string' || !datetime(v.at)))
      issue('INVALID_VERIFIED', 'verified should be a {by, at} mapping or a list of such mappings.');
    for (const verifier of verifiers) if (record(verifier) && !actor(verifier.by))
      issue('INVALID_ACTOR', 'verified.by should use producer/version, human:id or process:id.');
  }
  return issues;
}

export function checkedPage(content: string, path: string): ParsedPage {
  const issues = inspectMarkdown(content, path);
  const errors = issues.filter(x => x.severity === 'error');
  if (errors.length) throw new AkbError(errors[0]!.code, errors[0]!.message, 3);
  const page = parsePage(content);
  const metadata: Record<string, unknown> = { ...page.metadata, status: page.metadata.status ?? 'stable' };
  if (record(page.metadata.verified)) metadata.verified = [page.metadata.verified];
  return { ...page, metadata };
}

export function reservedDiagnostics(content: string, path: string): Diagnostic[] {
  const invalid = (message: string): Diagnostic[] => [{ code: 'INVALID_RESERVED_FILE', path, severity: 'error', message }];
  if (path.split('/').pop() === 'index.md') {
    if (/^(?:\uFEFF)?---\r?\n/.test(content)) {
      if (path !== 'index.md') return invalid('Only the root index may have okf_version Frontmatter.');
      try {
        const m = parsePage(content).metadata;
        if (Object.keys(m).some(x => x !== 'okf_version') || (m.okf_version !== undefined && typeof m.okf_version !== 'string'))
          return invalid('Root index Frontmatter may only contain a string okf_version.');
      } catch { return invalid('Invalid root index Frontmatter.'); }
    }
  } else {
    if (/^---\r?\n/.test(content)) return invalid('log.md must not contain Concept Frontmatter.');
    for (const heading of content.matchAll(/^## (.+)$/gm)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(heading[1]!)) return invalid('Log date headings must use YYYY-MM-DD.');
    }
  }
  return [];
}
