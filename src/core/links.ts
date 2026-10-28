import { existsSync, lstatSync } from 'node:fs';
import { posix } from 'node:path';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import { AkbError } from '../errors.js';
import { safePath } from './bundle.js';
import { parsePage, type Diagnostic } from './validation.js';

const parser = remark().use(remarkGfm);
type Node = ReturnType<typeof parser.parse> | ReturnType<typeof parser.parse>['children'][number];
const identifier = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

export function linkDiagnostics(root: string, path: string, content: string): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const warn = (code: string, message: string) => issues.push({ code, severity: 'warning', path, message });
  let body = content, metadata: Record<string, unknown> = {};
  if (/^(?:\uFEFF)?---\r?\n/.test(content)) {
    try { ({ body, metadata } = parsePage(content)); }
    catch { return issues; }
  }
  const tree = parser.parse(body);
  const footnotes = new Set<string>();
  function visit(node: Node, fn: (node: Node) => void): void {
    fn(node);
    if ('children' in node) for (const child of node.children) visit(child, fn);
  }
  function checkTarget(url: string, source = false): void {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return;
    const raw = url.split(/[?#]/, 1)[0]!;
    if (!raw) return;
    // OKF permits population/scope descriptors as sources, as well as file paths.
    if (source && !raw.startsWith('.') && !raw.includes('/') && !/\.[a-z0-9]{1,8}$/i.test(raw)) return;
    try {
      const decoded = decodeURIComponent(raw);
      let rel = posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : posix.join(posix.dirname(path), decoded));
      if (rel === '.') rel = 'index.md';
      rel = rel.replace(/\/+$/, '');
      let target = safePath(root, rel);
      if (existsSync(target) && lstatSync(target).isDirectory()) target = safePath(root, `${rel}/index.md`);
      if (!existsSync(target)) warn('BROKEN_LINK', 'Internal link or source target does not exist.');
    } catch (error) {
      if (error instanceof URIError || error instanceof AkbError) warn('UNSAFE_LINK', 'Internal link is malformed, inaccessible or outside the allowed Bundle paths.');
      else throw error;
    }
  }
  visit(tree, node => {
    if (node.type === 'footnoteReference') footnotes.add(identifier(node.identifier));
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') checkTarget(node.url);
  });
  const sourceIds = new Set<string>();
  if (Array.isArray(metadata.sources)) {
    for (const entry of metadata.sources) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.resource === 'string') checkTarget(entry.resource, true);
      if (typeof entry.id === 'string') {
        const id = identifier(entry.id);
        if (sourceIds.has(id)) warn('DUPLICATE_SOURCE_ID', 'Source IDs must be unique within a Concept.');
        sourceIds.add(id);
      }
    }
  }
  if (metadata.type !== undefined) {
    for (const id of footnotes) if (!sourceIds.has(id)) warn('FOOTNOTE_SOURCE_MISSING', 'Footnote citation has no matching sources entry.');
  }
  return issues;
}
