import { existsSync, lstatSync, realpathSync, readdirSync, readFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { AkbError, fileError } from '../errors.js';
import { git } from '../process.js';

export const reserved = (path: string): boolean => ['index.md', 'log.md'].includes(basename(path).toLowerCase());
export const contentDirectories = ['knowledge', 'source'] as const;
export const conceptFile = (path: string): boolean => path.endsWith('.md') && !reserved(path) &&
  contentDirectories.some(dir => path.startsWith(`${dir}/`));
const excluded = new Set(['node_modules', 'dist', 'build', 'vendor', 'coverage']);
export const hash = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const expand = (path: string): string => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path);
export const cacheRoot = (): string => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'akb');
export const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
};

export function bundleRoot(path: string): string {
  try {
    const root = realpathSync(expand(path));
    if (!lstatSync(root).isDirectory()) throw new AkbError('INVALID_BUNDLE', 'Bundle must be a directory.', 3);
    if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root)
      throw new AkbError('INVALID_BUNDLE', 'Bundle must be a Git repository root.', 3);
    return root;
  } catch (error) { return fileError(error); }
}

export function safePath(root: string, rel: string, concept = false): string {
  root = realpathSync(root);
  const segments = rel.split('/');
  if (!rel || isAbsolute(rel) || rel.includes('\\') || /[\x00-\x1f\x7f]/.test(rel) ||
      segments.some(x => !x || x === '.' || x === '..' || x.startsWith('.') || excluded.has(x.toLowerCase())) ||
      (concept && !conceptFile(rel)))
    throw new AkbError('UNSAFE_PATH', 'Use a Bundle-relative path outside reserved and control directories; Concept paths must be under knowledge/ or source/.', 6);
  let cursor = root;
  for (const segment of segments) {
    try {
      const names = readdirSync(cursor);
      if (names.some(name => name !== segment && name.toLowerCase() === segment.toLowerCase()))
        throw new AkbError('CASE_CONFLICT', 'Path conflicts with existing filename casing.', 5);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fileError(error);
    }
    cursor = join(cursor, segment);
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new AkbError('UNSAFE_PATH', 'Symbolic links are not allowed in Bundle paths.', 6);
      if (!inside(root, realpathSync(cursor))) throw new AkbError('UNSAFE_PATH', 'Path escapes Bundle.', 6);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fileError(error);
    }
  }
  return cursor;
}

export function conceptPath(root: string, id: string): string {
  if (id.endsWith('.md')) throw new AkbError('INVALID_ID', 'Concept ID omits the .md suffix.', 2);
  return safePath(root, `${id}.md`, true);
}

export function markdownFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.name.startsWith('.') || excluded.has(entry.name.toLowerCase())) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new AkbError('UNSAFE_PATH', 'Bundle contains a symbolic link. Remove it before scanning.', 6);
      safePath(root, rel);
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(rel);
    }
  }
  try {
    if (existsSync(join(root, 'source-text')) && !existsSync(join(root, 'source')))
      throw new AkbError('INVALID_BUNDLE', 'Rename legacy source-text/ to source/ and update its references explicitly; AKB will not move user files automatically.', 3);
    let found = false;
    for (const dir of contentDirectories) {
      const path = safePath(root, dir);
      if (!existsSync(path)) continue;
      if (!lstatSync(path).isDirectory()) throw new AkbError('INVALID_BUNDLE', `${dir} must be a directory.`, 3);
      found = true;
      walk(dir);
    }
    if (!found) throw new AkbError('INVALID_BUNDLE', 'KB content must be under knowledge/ or source/. Move legacy pages explicitly; AKB will not move them automatically.', 3);
    for (const entry of readdirSync(root)) {
      if (reserved(entry)) {
        const path = safePath(root, entry);
        if (lstatSync(path).isFile()) files.push(entry);
      }
    }
  } catch (error) { fileError(error); }
  return files;
}

export function readUtf8(path: string): string {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new AkbError('INVALID_FILE', 'Markdown input must be a regular file.', 3);
    if (stat.size > 4 * 1024 * 1024) throw new AkbError('FILE_TOO_LARGE', 'Markdown input exceeds the MVP 4 MiB limit.', 3);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
  } catch (error) {
    if (error instanceof TypeError) throw new AkbError('INVALID_UTF8', 'Markdown must be valid UTF-8.', 3);
    return fileError(error);
  }
}

export function withLock<T>(identity: string, kind: string, fn: () => T): T {
  const dir = join(cacheRoot(), 'locks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${hash(identity)}-${kind}.lock`);
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AkbError('LOCK_BUSY', 'AKB lock is occupied. Retry; remove a stale lock only after verifying its process has ended.', 5);
    return fileError(error);
  }
  try { return fn(); }
  finally { closeSync(fd); unlinkSync(path); }
}
