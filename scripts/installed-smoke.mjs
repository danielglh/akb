import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

const cli = resolve(process.argv[2] ?? 'dist/cli.js');
const reportPath = process.argv[3];
assert.ok(reportPath, 'Usage: node scripts/installed-smoke.mjs CLI_PATH REPORT_PATH');
const temp = mkdtempSync(join(tmpdir(), 'akb-package-smoke-'));
const env = { ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), XDG_CACHE_HOME: join(temp, 'cache') };
const report = { passed: false, platform: platform(), arch: arch(), node: process.version, checks: [] };
function run(command, args) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
function akb(...args) { return JSON.parse(run(process.execPath, [cli, '--kb', 'smoke', ...args, '--format', 'json'])); }
try {
  const skills = join(dirname(dirname(realpathSync(cli))), 'skills');
  assert.deepEqual(readdirSync(skills).sort(), ['akb-ingest', 'akb-search']);
  for (const name of ['akb-ingest', 'akb-search']) {
    const content = readFileSync(join(skills, name, 'SKILL.md'), 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(content);
    assert.ok(front, `Missing Skill Frontmatter: ${name}`);
    assert.equal(parse(front[1]).name, name);
  }
  report.checks.push('packaged_skills');
  report.git = run('git', ['--version']).trim();
  report.ripgrep = run('rg', ['--version']).split('\n')[0];
  report.qmd = run('qmd', ['--version']).trim();
  if (existsSync('/etc/os-release')) report.os_release = readFileSync('/etc/os-release', 'utf8');
  akb('init', join(temp, 'kb'), '--git');
  akb('add', 'smoke', join(temp, 'kb'));
  report.checks.push('init', 'register');
  akb('init', join(temp, 'second-kb'), '--git');
  akb('add', 'second', join(temp, 'second-kb'));
  assert.deepEqual(akb('list').knowledge_bases.map(kb => kb.name), ['smoke', 'second']);
  const missing = spawnSync(process.execPath, [cli, 'get', 'knowledge/topic', '--format', 'json'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).error.code, 'KB_REQUIRED');
  report.checks.push('multi_kb_registry', 'explicit_kb_required');
  const input = join(temp, 'input.md');
  writeFileSync(input, '---\ntype: Reference\ntitle: Linux package smoke\n---\nPackage vacuum originalmarker.\n');
  akb('create', '--path', 'knowledge/topic', '--from-file', input);
  const before = akb('get', 'knowledge/topic');
  writeFileSync(input, before.content + 'Updatedmarker proof.\n');
  const args = ['update', '--path', 'knowledge/topic', '--from-file', input, '--expect-hash', before.hash];
  akb(...args, '--dry-run');
  assert.equal(akb('get', 'knowledge/topic').hash, before.hash);
  akb(...args);
  assert.notEqual(akb('get', 'knowledge/topic').hash, before.hash);
  report.checks.push('create', 'read', 'hash', 'dry_run', 'update');
  const lint = akb('lint');
  assert.equal(lint.valid, true);
  assert.deepEqual(lint.pending_checks, []);
  assert.ok(lint.checks.includes('markdown_links'));
  report.checks.push('lint');
  const configPath = join(env.XDG_CONFIG_HOME, 'akb', 'config.yaml');
  const config = parse(readFileSync(configPath, 'utf8'));
  config.retrieval = { provider: 'qmd', fallback: 'none' };
  writeFileSync(configPath, stringify(config));
  assert.equal(akb('search-index', 'status').status, 'available');
  const found = akb('search', 'Updatedmarker');
  assert.equal(found.provider, 'qmd');
  assert.equal(found.degraded, false);
  assert.equal(found.results[0].path, 'knowledge/topic.md');
  report.checks.push('real_qmd_index', 'real_qmd_search');
  config.retrieval = { provider: 'ripgrep', fallback: 'none' };
  writeFileSync(configPath, stringify(config));
  assert.equal(akb('search', 'Updatedmarker').results[0].path, 'knowledge/topic.md');
  assert.equal(akb('search-index', 'status').status, 'not_required');
  report.checks.push('ripgrep_search', 'provider_switch');
  akb('remove', 'smoke');
  assert.ok(existsSync(join(temp, 'kb', 'knowledge/topic.md')));
  assert.deepEqual(akb('list').knowledge_bases.map(kb => kb.name), ['second']);
  report.checks.push('unregister_preserves_files');
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  rmSync(temp, { recursive: true, force: true });
}
console.log(`Installed package smoke passed on ${report.platform}/${report.arch}: ${reportPath}`);
