import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { AkbError } from '../errors.js';
import type { Config, Provider } from '../config.js';
import { getConcept } from '../core/concept.js';
import { safePath } from '../core/bundle.js';
import { datetime, parsePage } from '../core/validation.js';
import { qmd } from './qmd.js';
import { ripgrep, terms } from './ripgrep.js';
import type { Candidate, Retriever } from './interface.js';

export function search(root: string, name: string, config: Config, query: string, limit = 10, mode = 'keyword',
  implementations: Record<Provider, Retriever> = { qmd, ripgrep }) {
  if (!query.trim() || query.length > 2000 || /[\x00-\x1f\x7f]/.test(query)) throw new AkbError('INVALID_QUERY', 'Query must contain 1–2000 printable characters.', 2);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AkbError('INVALID_LIMIT', 'Limit must be an integer between 1 and 100.', 2);
  if (mode !== 'keyword') throw new AkbError('UNSUPPORTED_MODE', 'Only keyword mode is enabled in this release.', 2);
  let provider = config.retrieval.provider;
  let degraded = false, reason: string | null = null;
  let candidates: Candidate[];
  try { candidates = implementations[provider].search({ root, query, limit }); }
  catch (error) {
    if (!(error instanceof AkbError) || error.exitCode !== 4 || provider !== 'qmd' || config.retrieval.fallback !== 'ripgrep') throw error;
    provider = 'ripgrep'; degraded = true; reason = error.code;
    candidates = implementations.ripgrep.search({ root, query, limit });
  }
  const seen = new Set<string>();
  const results = candidates.flatMap(candidate => {
    const path = safePath(root, candidate.path, true);
    if (!existsSync(path) || seen.has(candidate.path)) return [];
    seen.add(candidate.path);
    const page = getConcept(root, candidate.path.slice(0, -3));
    const parsed = parsePage(page.content);
    const bodyLines = parsed.body.split(/\r?\n/);
    const keywords = terms(query).map(x => x.toLowerCase());
    const matches = bodyLines.flatMap((line, index) => keywords.some(term => line.toLowerCase().includes(term)) ? [index] : []);
    const first = matches[0];
    const staleAfter = page.metadata.stale_after;
    return [{ kb: name, concept_id: page.concept_id, path: page.path,
      title: typeof page.metadata.title === 'string' ? page.metadata.title : basename(page.path, '.md'),
      line: first === undefined ? null : parsed.bodyLine + first,
      snippet: first === undefined ? bodyLines.find(x => x.trim())?.slice(0, 300) ?? '' : bodyLines[first]!.slice(0, 300),
      score: provider === 'ripgrep' ? null : candidate.score, status: page.metadata.status,
      stale: datetime(staleAfter) ? Date.now() >= Date.parse(staleAfter) : false,
      matched_lines: matches.length }];
  });
  if (provider === 'ripgrep') results.sort((a, b) => b.matched_lines - a.matched_lines || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { query, scope: [name], requested_provider: config.retrieval.provider, provider,
    requested_mode: mode, mode: 'keyword', degraded, degradation_reason: reason,
    results: results.slice(0, limit).map(({ matched_lines: _, ...result }) => result) };
}
