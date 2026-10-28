import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { parseDocument, stringify } from 'yaml';
import { AkbError, fileError } from './errors.js';
import { bundleRoot, expand, withLock } from './core/bundle.js';

export type Provider = 'qmd' | 'ripgrep';
export interface Config {
  version: 1;
  knowledge_base?: { name: string; path: string };
  retrieval: { provider: Provider; fallback: 'ripgrep' | 'none' };
}
export const configPath = (): string => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'akb', 'config.yaml');

export function loadConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) return { version: 1, retrieval: { provider: 'qmd', fallback: 'ripgrep' } };
  try {
    const doc = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
    if (doc.errors.length) throw new Error();
    const c = doc.toJS({ maxAliasCount: 50 }) as Config;
    if (!c || c.version !== 1 || !['qmd', 'ripgrep'].includes(c.retrieval?.provider) ||
        !['ripgrep', 'none'].includes(c.retrieval?.fallback) ||
        (c.knowledge_base && (typeof c.knowledge_base.path !== 'string' || !c.knowledge_base.path ||
          typeof c.knowledge_base.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.knowledge_base.name)))) throw new Error();
    return c;
  } catch { throw new AkbError('INVALID_CONFIG', 'Invalid AKB config. Check version, knowledge_base and retrieval settings.', 2); }
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
    if (config.knowledge_base) throw new AkbError('KB_ALREADY_REGISTERED', 'Unregister the existing KB before registering another.', 2);
    config.knowledge_base = { name, path: root };
    saveConfig(config);
    return config;
  });
}

export function unregister(name: string): { removed: string } {
  return withLock(configPath(), 'config', () => {
    const c = loadConfig();
    if (c.knowledge_base?.name !== name) throw new AkbError('UNKNOWN_KB', 'Requested KB is not registered.', 2);
    delete c.knowledge_base;
    saveConfig(c);
    return { removed: name };
  });
}

export function selected(name?: string): { config: Config; name: string; root: string } {
  const config = loadConfig();
  const kb = config.knowledge_base;
  if (!kb || (name && kb.name !== name)) throw new AkbError('UNKNOWN_KB', 'Requested KB is not registered. Use akb add.', 2);
  const root = bundleRoot(kb.path);
  return { config, name: kb.name, root };
}
