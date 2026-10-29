import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { parseDocument, stringify } from 'yaml';
import { AkbError, fileError } from './errors.js';
import { bundleRoot, expand, withLock } from './core/bundle.js';

export type Provider = 'qmd' | 'ripgrep';
interface KnowledgeBase { name: string; path: string }
export interface Config {
  version: 2;
  knowledge_bases: KnowledgeBase[];
  retrieval: { provider: Provider; fallback: 'ripgrep' | 'none' };
}
export const configPath = (): string => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'akb', 'config.yaml');

export function loadConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) return { version: 2, knowledge_bases: [], retrieval: { provider: 'qmd', fallback: 'ripgrep' } };
  try {
    const doc = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
    if (doc.errors.length) throw new Error();
    const c = doc.toJS({ maxAliasCount: 50 });
    if (!c || ![1, 2].includes(c.version) || !['qmd', 'ripgrep'].includes(c.retrieval?.provider) ||
        !['ripgrep', 'none'].includes(c.retrieval?.fallback) ||
        (c.version === 1 && c.knowledge_bases !== undefined) ||
        (c.version === 2 && c.knowledge_base !== undefined)) throw new Error();
    const entries: unknown = c.version === 1 ? (c.knowledge_base === undefined ? [] : [c.knowledge_base]) : c.knowledge_bases;
    if (!Array.isArray(entries) || !entries.every((kb: unknown): kb is KnowledgeBase => {
      if (!kb || typeof kb !== 'object' || Array.isArray(kb)) return false;
      const entry = kb as Record<string, unknown>;
      return typeof entry.name === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(entry.name) && typeof entry.path === 'string' && !!entry.path;
    }) || new Set(entries.map(kb => kb.name)).size !== entries.length) throw new Error();
    return { version: 2, knowledge_bases: entries, retrieval: c.retrieval };
  } catch { throw new AkbError('INVALID_CONFIG', 'Invalid AKB config. Check version, knowledge_bases and retrieval settings.', 2); }
}

function saveConfig(config: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  try { writeFileSync(temp, stringify(config), { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  catch (error) { fileError(error); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}

export function register(name: string, path: string): Config {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new AkbError('INVALID_NAME', 'KB name must use lowercase letters, digits and hyphens.', 2);
  const root = bundleRoot(expand(path));
  return withLock(configPath(), 'config', () => {
    const config = loadConfig();
    if (config.knowledge_bases.some(kb => kb.name === name)) throw new AkbError('KB_ALREADY_REGISTERED', 'KB name is already registered; choose another name or unregister it first.', 2);
    config.knowledge_bases.push({ name, path: root });
    saveConfig(config);
    return config;
  });
}

export function unregister(name: string): { removed: string } {
  return withLock(configPath(), 'config', () => {
    const c = loadConfig();
    if (!c.knowledge_bases.some(kb => kb.name === name)) throw new AkbError('UNKNOWN_KB', 'Requested KB is not registered.', 2);
    c.knowledge_bases = c.knowledge_bases.filter(kb => kb.name !== name);
    saveConfig(c);
    return { removed: name };
  });
}

export function selected(name?: string): { config: Config; name: string; root: string } {
  if (!name) throw new AkbError('KB_REQUIRED', 'Specify a registered KB with --kb NAME. Use akb list to see registered names.', 2);
  const config = loadConfig();
  const kb = config.knowledge_bases.find(kb => kb.name === name);
  if (!kb) throw new AkbError('UNKNOWN_KB', 'Requested KB is not registered. Use akb list or akb add.', 2);
  const root = bundleRoot(kb.path);
  return { config, name: kb.name, root };
}
