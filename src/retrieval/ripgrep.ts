import { run } from '../process.js';
import { conceptFile, markdownFiles } from '../core/bundle.js';
import type { Candidate, Retriever, SearchRequest } from './interface.js';

export const terms = (query: string): string[] => [...new Set(query.trim().split(/\s+/u))];

export const ripgrep: Retriever = {
  search({ root, query }: SearchRequest): Candidate[] {
    const files = markdownFiles(root).filter(conceptFile);
    const matching = new Map<string, Set<number>>();
    terms(query).forEach((term, termIndex) => {
      for (let offset = 0; offset < files.length; offset += 100) {
        const batch = files.slice(offset, offset + 100);
        const output = run('rg', ['--no-config', '--json', '--text', '--ignore-case', '--fixed-strings', '-e', term, '--', ...batch],
          { cwd: root, accept: [0, 1] });
        for (const line of output.trim().split('\n').filter(Boolean)) {
          const row = JSON.parse(line) as { type: string; data: { path?: { text?: string } } };
          const path = row.data.path?.text;
          if (row.type !== 'match' || !path || !batch.includes(path)) continue;
          if (!matching.has(path)) matching.set(path, new Set());
          matching.get(path)!.add(termIndex);
        }
      }
    });
    return [...matching].filter(([, indices]) => indices.size === terms(query).length).map(([path]) => ({ path, score: null }));
  },
};
