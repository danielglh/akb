import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { grade, invoke, prepare } from '../scripts/eval.mjs';

// Scripted outputs exercise the grader; they are not an Agent evaluation.
it('grades actual KB bytes and rejects false decisions, citations, mutations and missing responses', () => {
  const temp = mkdtempSync(join(tmpdir(), 'akb-eval-test-'));
  try {
    const run = prepare(temp);
    const inputs = ['new-topic', 'update', 'duplicate', 'contradiction', 'version-difference', 'insufficient', 'injection'];
    for (const name of inputs) {
      const dir = join(run, name);
      const decision = ({ 'new-topic': 'Create', update: 'Update', 'version-difference': 'Create', contradiction: 'Review', insufficient: 'Review' } as Record<string, string>)[name] ?? 'No-op';
      let id = 'engineering/atlas-retries';
      if (decision === 'Create' || decision === 'Update') {
        const old = invoke(dir, ['get', id]);
        const metadata = decision === 'Update' ? old.metadata : { type: 'Reference', title: name, description: 'Synthetic evaluation output', tags: ['evaluation'], sources: [] };
        metadata.status = 'draft';
        metadata.sources.push({ id: 'supplied', resource: pathToFileURL(join(dir, 'input.txt')).href, title: 'Synthetic input' });
        let body = decision === 'Update' ? old.content.split('\n---\n').slice(1).join('\n---\n') : '# Policy\n\n';
        body += name === 'new-topic' ? 'Boreal backup retention: seven days; restoration monthly.[^supplied]\n' : name === 'update' ? 'Atlas request ID diagnostics.[^supplied]\n' : 'Atlas v2 allows five retries. v1 retains three; see [v1](atlas-retries.md).[^supplied]\n';
        body += '\n[^supplied]: Synthetic supplied input.\n';
        const candidate = join(dir, 'candidate.md');
        writeFileSync(candidate, `---\n${stringify(metadata)}---\n${body}`);
        if (decision === 'Create') id = name === 'new-topic' ? 'engineering/boreal' : 'engineering/atlas-v2';
        invoke(dir, [decision.toLowerCase(), '--path', id, '--from-file', candidate, ...(decision === 'Update' ? ['--expect-hash', old.hash] : [])]);
      }
      const page = invoke(dir, ['get', id]);
      const lines = page.content.split('\n');
      const line = lines.findIndex((s: string) => s.includes('Boreal backup') || s.includes('Atlas request ID') || s.includes('Atlas v2 allows') || s.includes('Atlas API v1 transient'));
      writeFileSync(join(dir, 'response.json'), JSON.stringify({ agent: 'scripted-grader-test', decision, reason: 'Test output', citation: { path: page.path, line: line + 1, excerpt: lines[line] } }));
    }
    const passed = grade(run, process.env.AKB_TEST_QMD === '1' ? ['ripgrep', 'qmd'] : ['ripgrep']);
    expect(passed.cases.flatMap((c: any) => c.checks.filter((x: any) => !x.passed))).toEqual([]);
    expect(passed.automated_passed).toBe(true);
    expect(passed.semantic_review_required).toBe(true);

    const duplicate = join(run, 'duplicate/response.json');
    const response = JSON.parse(readFileSync(duplicate, 'utf8'));
    response.decision = 'Create';
    response.citation.excerpt = 'fabricated citation';
    writeFileSync(duplicate, JSON.stringify(response));
    writeFileSync(join(run, 'injection/kb/references/atlas-policy.txt'), 'tampered source');
    rmSync(join(run, 'insufficient/response.json'));
    const failed = grade(run);
    expect(failed.automated_passed).toBe(false);
    for (const [input, check] of [['duplicate.txt', 'decision'], ['duplicate.txt', 'citation'], ['injection.txt', 'write_scope'], ['insufficient.txt', 'case_execution']])
      expect(failed.cases.find((c: any) => c.input === input).checks.find((c: any) => c.name === check).passed).toBe(false);
    const config = parse(readFileSync(join(run, 'duplicate/config/akb/config.yaml'), 'utf8'));
    expect(config.retrieval.provider).toBe('ripgrep');
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 60_000);
