import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { initialize, createConcept } from '../src/core/concept.js';
import { qmd } from '../src/retrieval/qmd.js';

const original = { ...process.env };
let temp: string | undefined;
afterEach(() => { process.env = { ...original }; if (temp) rmSync(temp, { recursive: true, force: true }); });
it('passes isolated config, named index and literal query to the QMD subprocess', () => {
  temp = mkdtempSync(join(tmpdir(), 'akb-qmd-protocol-'));
  process.env.XDG_CACHE_HOME = join(temp, 'cache');
  const root = join(temp, 'kb'); initialize(root, true);
  createConcept(root, 'knowledge/topic', '---\ntype: Reference\n---\nAtlas API retries.\n');
  const bin = join(temp, 'bin'); mkdirSync(bin);
  const log = join(temp, 'calls.jsonl');
  writeFileSync(join(bin, 'qmd'), `#!${process.execPath}\n` + `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args,cwd:process.cwd(),config:process.env.QMD_CONFIG_DIR,cache:process.env.XDG_CACHE_HOME,trust:process.env.QMD_TRUST_LOCAL_CONFIG})+'\\n');
if(args.includes('--version')) console.log('qmd 2.8.3');
else if(args.includes('search')) console.log(JSON.stringify([{file:'qmd://kb/knowledge/topic.md',score:0.8}]));
else console.log('OK');
`, { mode: 0o755 });
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.QMD_TRUST_LOCAL_CONFIG = '1';
  process.env.QMD_CONFIG_DIR = join(temp, 'unrelated');
  const results = qmd.search({ root, query: '--help $(unsafe)', limit: 5 });
  expect(results).toEqual([{ path: 'knowledge/topic.md', score: 0.8 }]);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(calls.map(c => c.args)).toEqual([
    ['--index', 'akb', '--version'],
    ['--index', 'akb', 'update'],
    ['--index', 'akb', 'search', '-c', 'kb', '--json', '-n', '5', '--', '--help $(unsafe)'],
  ]);
  for (const c of calls) {
    expect(c.config).not.toBe(process.env.QMD_CONFIG_DIR);
    expect(c.cwd).not.toBe(root);
    expect(c.trust).toBeUndefined();
  }
  const config = parse(readFileSync(join(calls[0].config, 'akb.yml'), 'utf8'));
  expect(Object.keys(config.collections)).toEqual(['kb']);
  expect(config.collections.kb.update).toBeUndefined();
  expect(config.collections.kb.path).toContain('/kb');
  expect(config.collections.kb.ignore).toContain('**/index.md');
});
