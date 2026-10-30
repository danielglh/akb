import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AkbError, fileError } from '../errors.js';
import { git, run } from '../process.js';
import { bundleRoot, conceptPath, contentDirectories, expand, hash, markdownFiles, readUtf8, reserved, safePath, withLock } from './bundle.js';
import { checkedPage, inspectMarkdown, reservedDiagnostics } from './validation.js';
import { linkDiagnostics } from './links.js';

export function initialize(path: string, initGit: boolean): { path: string; created: string[] } {
  const expanded = expand(path);
  try {
    mkdirSync(expanded, { recursive: true });
    if (initGit) {
      // Do not execute repository hooks or inherit a parent repository as the KB.
      if (!existsSync(join(expanded, '.git'))) git(expanded, ['init', '--quiet', '--template=']);
    }
    const root = bundleRoot(expanded);
    return withLock(root, 'write', () => {
      const index = safePath(root, 'index.md');
      if (existsSync(index)) throw new AkbError('ALREADY_EXISTS', 'index.md already exists; initialization does not overwrite it.', 5);
      const created = ['index.md'];
      for (const dir of contentDirectories) {
        const target = safePath(root, dir);
        if (existsSync(target)) {
          if (!lstatSync(target).isDirectory()) throw new AkbError('INVALID_BUNDLE', `${dir} must be a directory.`, 3);
        } else { mkdirSync(target); created.push(`${dir}/`); }
        const navigation = safePath(root, `${dir}/index.md`);
        if (!existsSync(navigation)) {
          writeFileSync(navigation, `# ${dir}\n`, { flag: 'wx', mode: 0o644 });
          created.push(`${dir}/index.md`);
        }
      }
      writeFileSync(index, '---\nokf_version: "0.2"\n---\n# Knowledge Base\n\n- [Knowledge](knowledge/)\n- [Source text](source/)\n', { flag: 'wx', mode: 0o644 });
      return { path: root, created };
    });
  } catch (error) { return fileError(error); }
}

export function getConcept(root: string, id: string) {
  const path = conceptPath(root, id);
  const content = readUtf8(path);
  const parsed = checkedPage(content, `${id}.md`);
  return { concept_id: id, path: `${id}.md`, content, hash: hash(Buffer.from(content, 'utf8')), metadata: parsed.metadata };
}

function diff(id: string, before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'akb-diff-'));
  try {
    writeFileSync(join(dir, 'before'), before);
    writeFileSync(join(dir, 'after'), after);
    return run('git', ['-c', 'core.fsmonitor=false', 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--', 'before', 'after'],
      { cwd: dir, accept: [0, 1] }).replaceAll('a/before', `a/${id}.md`).replaceAll('b/after', `b/${id}.md`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function writeConcept(root: string, id: string, content: string, expectedHash: string | undefined, dryRun: boolean) {
  root = bundleRoot(root);
  if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new AkbError('FILE_TOO_LARGE', 'Markdown input exceeds the MVP 4 MiB limit.', 3);
  checkedPage(content, `${id}.md`);
  return withLock(root, 'write', () => {
    const target = conceptPath(root, id);
    const exists = existsSync(target);
    let before = '';
    if (expectedHash === undefined) {
      if (exists) throw new AkbError('ALREADY_EXISTS', 'Target already exists; nothing was overwritten.', 5);
    } else {
      if (!exists) throw new AkbError('NOT_FOUND', 'Concept does not exist.', 3);
      before = readUtf8(target);
      if (hash(before) !== expectedHash) throw new AkbError('HASH_CONFLICT', 'Concept changed. Read again and merge before retrying.', 5);
    }
    const preview = diff(id, before, content);
    const result = { path: `${id}.md`, hash: hash(content), dry_run: dryRun, changed: before !== content,
      diff: preview, diagnostics: [...inspectMarkdown(content, `${id}.md`), ...linkDiagnostics(root, `${id}.md`, content)] };
    if (dryRun || before === content) return result;
    try {
      mkdirSync(dirname(target), { recursive: true });
      conceptPath(root, id);
      const temp = join(dirname(target), `.akb-${randomUUID()}.tmp`);
      let fd: number | undefined;
      try {
        fd = openSync(temp, 'wx', 0o600);
        writeFileSync(fd, content);
        fsyncSync(fd);
        closeSync(fd); fd = undefined;
        chmodSync(temp, exists ? lstatSync(target).mode & 0o777 : 0o644);
        conceptPath(root, id);
        if (expectedHash === undefined) linkSync(temp, target);
        else {
          if (hash(readUtf8(target)) !== expectedHash) throw new AkbError('HASH_CONFLICT', 'Concept changed during write. Read again and merge.', 5);
          renameSync(temp, target);
        }
      } finally {
        if (fd !== undefined) closeSync(fd);
        if (existsSync(temp)) unlinkSync(temp);
      }
      return result;
    } catch (error) { return fileError(error); }
  });
}

export const createConcept = (root: string, id: string, content: string, dryRun = false) => writeConcept(root, id, content, undefined, dryRun);
export function updateConcept(root: string, id: string, content: string, expectedHash: string, dryRun = false) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new AkbError('INVALID_HASH', 'Expected hash must be a SHA-256 hex string from akb get.', 2);
  return writeConcept(root, id, content, expectedHash, dryRun);
}

export function lintBundle(root: string) {
  const diagnostics = markdownFiles(root).flatMap(path => {
    const content = readUtf8(safePath(root, path));
    return [...(reserved(path) ? reservedDiagnostics(content, path) : inspectMarkdown(content, path)), ...linkDiagnostics(root, path, content)];
  });
  return { checks: ['frontmatter', 'lifecycle', 'provenance', 'reserved_files', 'markdown_links', 'source_footnotes'], pending_checks: [], diagnostics,
    valid: !diagnostics.some(x => x.severity === 'error') };
}
