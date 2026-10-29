import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { configPath, loadConfig, register, selected, unregister } from '../src/config.js';
import { initialize } from '../src/core/concept.js';
import { withLock } from '../src/core/bundle.js';

let temp: string;
const originalEnv = { ...process.env };
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'akb-config-'));
  process.env.XDG_CONFIG_HOME = join(temp, 'config');
  process.env.XDG_CACHE_HOME = join(temp, 'cache');
});
afterEach(() => { process.env = { ...originalEnv }; rmSync(temp, { recursive: true, force: true }); });

it('registers multiple KBs, requires a name, rejects duplicates and only unregisters the named KB', () => {
  expect(loadConfig().knowledge_bases).toEqual([]);
  const a = initialize(join(temp, 'a'), true).path;
  const b = initialize(join(temp, 'b'), true).path;
  register('a', a);
  expect(() => selected()).toThrow(/--kb/);
  register('b', b);
  expect(loadConfig().knowledge_bases).toEqual([{ name: 'a', path: a }, { name: 'b', path: b }]);
  expect(selected('a').root).toBe(a);
  expect(selected('b').root).toBe(b);
  const before = readFileSync(configPath(), 'utf8');
  expect(() => register('a', b)).toThrow(/already registered/);
  expect(() => selected('unknown')).toThrow(/not registered/);
  expect(() => unregister('unknown')).toThrow(/not registered/);
  withLock(configPath(), 'config', () => expect(() => unregister('a')).toThrow(/lock/));
  expect(readFileSync(configPath(), 'utf8')).toBe(before);
  unregister('a');
  expect(selected('b').root).toBe(b);
  expect(existsSync(join(a, 'index.md'))).toBe(true);
  unregister('b');
  expect(loadConfig().knowledge_bases).toEqual([]);
  expect(() => selected('b')).toThrow(/not registered/);
});

it('reads v1 without writing and migrates to v2 on a registry mutation', () => {
  const a = initialize(join(temp, 'a'), true).path;
  const b = initialize(join(temp, 'b'), true).path;
  const legacy = stringify({ version: 1, knowledge_base: { name: 'a', path: a }, retrieval: { provider: 'ripgrep', fallback: 'none' } });
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), legacy);
  expect(selected('a').root).toBe(a);
  expect(() => selected()).toThrow(/--kb/);
  expect(readFileSync(configPath(), 'utf8')).toBe(legacy);
  register('b', b);
  const migrated = parse(readFileSync(configPath(), 'utf8'));
  expect(migrated).toEqual({ version: 2, knowledge_bases: [{ name: 'a', path: a }, { name: 'b', path: b }], retrieval: { provider: 'ripgrep', fallback: 'none' } });
});

it.each([
  { version: 3, knowledge_bases: [] },
  { version: 2 },
  { version: 2, knowledge_bases: {} },
  { version: 2, knowledge_bases: [null] },
  { version: 2, knowledge_bases: [{ name: '../a', path: '/a' }] },
  { version: 2, knowledge_bases: [{ name: 'a', path: '' }] },
  { version: 2, knowledge_bases: [{ name: 'a', path: '/a' }, { name: 'a', path: '/b' }] },
  { version: 2, knowledge_base: { name: 'lost', path: '/a' }, knowledge_bases: [] },
  { version: 1, knowledge_bases: [{ name: 'lost', path: '/a' }] },
])('rejects malformed or ambiguous registry: %j', value => {
  mkdirSync(dirname(configPath()), { recursive: true });
  const original = stringify({ ...value, retrieval: { provider: 'ripgrep', fallback: 'none' } });
  writeFileSync(configPath(), original);
  expect(() => loadConfig()).toThrow(/Invalid AKB config/);
  expect(readFileSync(configPath(), 'utf8')).toBe(original);
});
