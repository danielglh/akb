#!/usr/bin/env node
import { Command, CommanderError, Option } from 'commander';
import { AkbError, fileError } from './errors.js';
import { configPath, loadConfig, register, selected, unregister } from './config.js';
import { initialize, createConcept, getConcept, lintBundle, updateConcept } from './core/concept.js';
import { readUtf8 } from './core/bundle.js';
import { search } from './retrieval/search.js';
import { qmdIndex, QMD_VERSION } from './retrieval/qmd.js';
import { git, run } from './process.js';

const program = new Command().name('akb').version('0.1.0').description('Local-first OKF knowledge tools');
program.addOption(new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'));
program.option('--kb <name>', 'registered KB name; required for KB-scoped commands');
program.exitOverride().configureOutput({ writeErr: () => {} });
const json = () => program.optsWithGlobals().format === 'json' || process.argv.includes('--format=json') ||
  process.argv.some((arg, index) => arg === '--format' && process.argv[index + 1] === 'json');
function output(value: unknown): void {
  const result = { schema_version: 1, ...(value as object) };
  if (json()) process.stdout.write(JSON.stringify(result) + '\n');
  else {
    if (value && typeof value === 'object' && 'content' in value) process.stdout.write(String(value.content));
    else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}
function command(name: string, description: string): Command { return program.command(name).description(description); }
const kb = (cmd: Command) => selected(cmd.optsWithGlobals().kb as string | undefined);

command('init <path>', 'Initialize an OKF Bundle').option('--git', 'initialize a Git repository').action((path, options) => output(initialize(path, !!options.git)));
command('add <name> <path>', 'Register a local KB by name').action((name, path) => output(register(name, path)));
command('list', 'List registered KB names and paths').action(() => output({ knowledge_bases: loadConfig().knowledge_bases }));
command('remove <name>', 'Unregister without deleting knowledge').action(name => output(unregister(name)));
command('info', 'Inspect the explicitly selected KB').action((_, cmd: Command) => {
  const { config, name, root } = kb(cmd);
  const dependencies = Object.fromEntries(['git', 'rg', 'qmd'].map(tool => {
    try { return [tool, { available: true, version: run(tool, ['--version']).trim().split('\n')[0] }]; }
    catch { return [tool, { available: false }]; }
  }));
  output({ name, path: root, config_path: configPath(), retrieval: config.retrieval,
    git_status: git(root, ['status', '--porcelain']), dependencies, qmd_target_version: QMD_VERSION });
});
command('get <id>', 'Read a Concept and raw-byte hash').action((id, _, cmd: Command) => {
  const { name, root } = kb(cmd); output({ kb: name, ...getConcept(root, id) });
});
for (const operation of ['create', 'update'] as const) {
  const cmd = command(operation, `${operation} an OKF Concept`).requiredOption('--path <id>', 'Bundle-relative Concept ID')
    .requiredOption('--from-file <file>', 'complete OKF Markdown input').option('--dry-run', 'validate and preview without writing');
  if (operation === 'update') cmd.requiredOption('--expect-hash <sha256>', 'raw-byte SHA-256 from akb get');
  cmd.action((options, cmd: Command) => {
    const { name, root } = kb(cmd);
    const content = readUtf8(options.fromFile);
    const result = operation === 'create' ? createConcept(root, options.path, content, options.dryRun)
      : updateConcept(root, options.path, content, options.expectHash, options.dryRun);
    output({ kb: name, ...result });
  });
}
command('search <query>', 'Search current knowledge').option('--limit <number>', 'maximum results', '10').option('--mode <mode>', 'retrieval mode', 'keyword')
  .action((query, options, cmd: Command) => {
    const { root, name, config } = kb(cmd);
    const result = search(root, name, config, query, Number(options.limit), options.mode);
    if (result.degraded) process.stderr.write(`Search degraded to ripgrep: ${result.degradation_reason}\n`);
    output(result);
  });
command('lint', 'Check OKF metadata, Markdown links and source footnotes').action((_, cmd: Command) => {
  const { root } = kb(cmd);
  const result = lintBundle(root); output(result);
  if (!result.valid) process.exitCode = 3;
});
const index = command('search-index', 'Manage the selected search index');
for (const operation of ['setup', 'refresh', 'status'] as const) {
  index.command(operation).action((_, cmd: Command) => {
    const { root, config } = kb(cmd);
    output(config.retrieval.provider === 'ripgrep' ? { provider: 'ripgrep', status: 'not_required' } : qmdIndex(root, operation));
  });
}

try { await program.parseAsync(); }
catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) process.exitCode = 0;
  else {
    let e: AkbError;
    if (error instanceof CommanderError) e = new AkbError('INVALID_ARGUMENT', error.message, 2);
    else if (error instanceof AkbError) e = error;
    else { try { fileError(error); } catch (converted) { e = converted as AkbError; } }
    const message = { error: { code: e!.code, message: e!.message } };
    if (json()) output(message);
    else process.stderr.write(`${e!.code}: ${e!.message}\n`);
    process.exitCode = e!.exitCode;
  }
}
