# AKB

Local-first knowledge tools for agents: **Git + Markdown + OKF + replaceable retrieval**.

AKB provides a multi-KB registry with explicit selection, safe OKF Concept writes, replaceable QMD / rg keyword retrieval, remark/GFM link checks, and two Agent Skills. Every KB-scoped command requires `--kb NAME`; there is no default KB. Historical MVP evaluations and subsequent verification are recorded in [MVP validation](docs/mvp-validation.md).

## Run locally

Requires Node.js 24–26, Git and ripgrep (`rg`) on PATH. Tested on macOS arm64 with Node 26.12.1, Git 2.54.0 and rg 15.2.0, and Linux arm64 (Debian 12, OrbStack Docker) with Node 24.22.1, Git 2.39.5 and rg 13.0.0.

```sh
npm ci
npm run build
node dist/cli.js --help
npm test
```

Run Linux verification with Docker/OrbStack using Node 24.22.1 on Debian Bookworm:

```sh
bash scripts/validate-linux.sh
```

It builds from source without mounting host dependencies or personal tool configuration, runs the full suite with real QMD enabled and no skipped tests, installs the npm tarball, and exercises writes, lint and both retrieval providers. Image builds and package installation require network access. Logs, image metadata, test JSON and installed-package smoke results go to `artifacts/linux-validation/`. On 2026-10-27, Linux arm64 passed all 43 tests with zero skips and all 13 installed-package smoke checks with QMD 2.8.3. See [MVP validation](docs/mvp-validation.md) for evidence and limits.

Dependencies are pinned in `package-lock.json`: Commander 15.0.0, yaml 2.9.1, remark 15.0.1, remark-gfm 4.0.1, TypeScript 6.0.3 and Vitest 5.0.4. The GFM plugin supplies parser support for source footnotes and reference links; AKB does not reimplement Markdown syntax with regexes.

To install the command after building, use `npm install --global .` in an environment where you authorize a global installation. Otherwise the examples work with `node /absolute/path/to/akb/dist/cli.js` in place of `akb`. No global installation or registration into your personal configuration was performed during development.

## Knowledge-base layout and scan scope

AKB defines two content directories per KB:

```text
my-kb/
├── index.md                 # Bundle navigation
├── knowledge/               # Curated OKF Concept pages
├── source/             # Citable OKF source pages and source attachments
├── README.md                # Ordinary repository documentation
├── INSTALL.md
└── AGENTS.md
```

`akb init` creates `knowledge/`, `source/` and their navigation indexes, plus the root `index.md`, without overwriting existing files. The indexes keep otherwise empty content directories in Git. Concept IDs include the directory prefix, for example `knowledge/operations/retries` or `source/policy-v1`.

Lint validates Markdown under `knowledge/` and `source/`, including nested navigation/log files, plus root `index.md` / `log.md`. Search indexes only non-reserved Concept pages in those two directories. Root instructions and other directories are outside that scope, regardless of filename or Frontmatter. Their links and example snippets are not linted. Knowledge pages can still link to repository docs, attachments and local sources; referenced paths retain boundary/symlink checks.

Malformed pages **inside** the content directories still fail validation; missing Frontmatter is not silently ignored. CLI Concept reads/writes outside those directories are rejected so repository documentation cannot be overwritten as a Concept.

For an older KB with pages at paths such as `engineering/topic.md`, explicitly move the actual content into `knowledge/` (or source pages into `source/`), update relative links/source paths and Concept IDs, then rerun lint and refresh the index. AKB never moves user files automatically. Legacy `source-text/` must be explicitly renamed to `source/` with its path references updated; scans reject an unmigrated legacy source directory instead of silently omitting its pages. If neither content directory exists, lint/index scans report `INVALID_BUNDLE` instead of a misleading empty success. Files left outside the defined content directories are not scanned. Raw source attachments without the `.md` extension can stay in `source/`; Markdown source pages there must use OKF.

## A complete local write/read/search loop

For an isolated trial, set `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` to temporary directories before the commands. AKB otherwise uses the normal user XDG locations.

```sh
akb init ./my-kb --git
akb add personal ./my-kb
akb info --kb personal --format json
```

Write a candidate to a temporary file, for example `/tmp/akb-concept.md`:

```markdown
---
type: Reference
title: Example retry policy
description: Synthetic retry policy for the local example.
status: draft
sources:
  - id: supplied-note
    resource: /source/retry-policy.txt
    title: User-supplied example note
---
# Example retry policy

For this fictional service, retry transient failures three times at most.[^supplied-note]

[^supplied-note]: User-supplied example note; create or replace the example source with its genuine location.
```

```sh
akb create --kb personal --path knowledge/operations/retries --from-file /tmp/akb-concept.md --dry-run --format json
akb create --kb personal --path knowledge/operations/retries --from-file /tmp/akb-concept.md --format json
akb get --kb personal knowledge/operations/retries --format json
akb search --kb personal "retry transient" --format json
akb lint --kb personal --format json
```

Edit a copy of the Concept outside the KB, then update using the exact `hash` returned by `get`:

```sh
akb update --kb personal --path knowledge/operations/retries --from-file /tmp/akb-updated.md --expect-hash HASH_FROM_GET --dry-run --format json
akb update --kb personal --path knowledge/operations/retries --from-file /tmp/akb-updated.md --expect-hash HASH_FROM_GET --format json
```

A stale hash is rejected. Re-read and merge rather than forcing the update. `create` never overwrites an existing file. All knowledge writes use an exclusive AKB lock, same-directory temporary files and atomic publication/replacement. Locks live under the AKB user cache, outside the KB.

AKB never stages or commits. Review `git -C ./my-kb status` and `git -C ./my-kb diff --no-ext-diff --no-textconv`. Ordinary Git Diff omits new untracked files: inspect those with `akb get` before staging them yourself. Uncommitted or untracked content is not guaranteed recoverable from Git.

## Retrieval configuration

The registry supports multiple named KBs. Its location is `~/.config/akb/config.yaml` (honors `XDG_CONFIG_HOME`). `akb add` registers; `akb list` lists names and paths; `akb remove NAME` unregisters only that name without deleting files. Names must be unique.

```yaml
version: 2
knowledge_bases:
  - name: personal
    path: /absolute/path/to/my-kb
  - name: work
    path: /absolute/path/to/work-kb
retrieval:
  provider: qmd
  fallback: ripgrep
```

Set `provider: ripgrep` to use rg directly; `fallback: none` disables fallback. These retrieval settings apply to all registered KBs; QMD indexes and locks remain isolated by each KB's canonical path.

Every `info`, `get`, `create`, `update`, `search`, `lint` and `search-index setup|refresh|status` command requires `--kb NAME`, even when only one KB is registered. Missing names return `KB_REQUIRED`; unregistered names return `UNKNOWN_KB`. Both exit with code 2 before reading or writing KB content. There is no default, current-directory selection, or implicit fallback to another KB.

```sh
akb add personal /absolute/path/to/my-kb
akb add work /absolute/path/to/work-kb
akb list --format json
akb search "retry" --kb personal --format json
akb search "retry" --kb work --format json
```

Existing version-1 configs are read without modification and their sole entry is retained. The next `add` or `remove` writes version 2 atomically under the existing config lock. Commands and Agent workflows that previously omitted `--kb` must now provide it. Older CLI versions do not understand version 2; update other installations sharing that config before changing the registry. Each search targets one named KB; combined cross-KB search is not implemented.

`akb search` accepts `--limit 1..100` and only `--mode keyword`. rg searches literal whitespace-separated terms, requiring all terms in the same page. It ranks by matching body-line count and then path. It supports Chinese text but does not perform Chinese word segmentation or semantic matching. QMD and rg rankings and scores are not comparable.

JSON includes requested and actual provider/mode, `degraded`, its reason, and current-file result snippets. QMD failure is distinguished from zero hits. Invalid KB names, arguments and unsafe paths never trigger a search in another scope.

### QMD adapter

The adapter is verified with **QMD 2.8.3 (facd35e)** and rejects other versions explicitly. Real integration tests cover setup, refresh, search, external edits/deletion, empty results, mixed-language queries and literal Unicode/space/punctuation filenames. Results preserve actual Bundle paths, including when QMD appends its named-index URI suffix.

After installing the target QMD version in an authorized environment:

```sh
npm install --global @tobilu/qmd@2.8.3
akb search-index setup --kb personal
akb search-index status --kb personal
akb search --kb personal "retry transient" --format json
npm run test:qmd
```

For each KB, the adapter generates an isolated collection/config/cache under the AKB cache, always selects an explicit named index, refreshes before keyword searches, and disables update hooks and inherited project trust flags. It does not read the SQLite schema or require embedding models. `search-index setup|refresh|status` returns `not_required` for rg.

Do not treat the adapter as a security boundary for an Agent that can access your filesystem. Separate filesystem identities/environments are required for access isolation.

## Agent Skills and evaluation

For repeatable evaluation, run `npm run eval:prepare`, have the tested Agent complete each generated `task.md`, then run `npm run eval:grade -- RUN_DIR` (append `ripgrep qmd` to require both real backends). The grader saves per-case checks, file hashes, citations and Top-5 retrieval evidence in `report.json`, and exits nonzero on failure. See [Eval workflow and limits](docs/evaluation.md). This is separate from the historical evaluation below; automated assertions still require semantic review.

Skills are in `skills/akb-ingest` and `skills/akb-search`. Install them using the chosen Agent's standard skill discovery mechanism; installation into global Agent directories is not performed automatically. Both need an installed `akb`, or the absolute built CLI path. They do not call QMD directly.

These replace the earlier `kb-ingest` / `kb-search` names. Replace old installed copies and regenerate any pending Eval task directories so their Skill paths use the new names.

`akb-ingest` selects Create / Update / No-op / Review. `akb-search` reads current pages and cites the supporting section. CLI validation checks structure, not factual truth or whether the Agent made a good semantic decision.

`examples/personal-kb` is a fictional OKF Bundle; initialize its copied directory as a Git repository before registering it. Sources are synthetic and labeled. `tests/fixtures/ingest/cases.json` defines seven semantic cases. For each, start from a fresh copy of the example, give the Agent the corresponding input and the Skill, then inspect actual decisions, files, sources and subsequent Top-5 keyword retrieval. No-op / Review must leave knowledge files unchanged.

The automated suite tests actual CLI/rg behavior, safe writes, parsed Markdown links and footnotes, protocol normalization, and missing-executable fallback. `npm run test:qmd` enables real QMD tests and fails if the selected version is unavailable. The seven semantic cases were run by an independent Codex evaluation Agent from fresh KB copies, using real QMD without fallback and then rg. The parent checked original preset queries, exact cited file content, source input hashes, unchanged files and repeat-ingestion snapshots. See [observations and parent review](docs/agent-evaluation.json).

Development verification on 2026-10-26: **43 automated checks passed, no skips with QMD enabled; seven semantic cases accepted**. The v2 case created a separate linked page rather than updating v1; the original expected decision and the reason for accepting that alternative are retained in the report. One initial Agent actor-format issue was corrected in the Skill and validator, then all seven cases were rerun from new copies. This is bounded synthetic evaluation, not a general factual-correctness guarantee.

TypeScript strict compilation and installation of the built npm tarball were also checked. Both Skills passed Frontmatter/naming checks with the installed YAML parser; the bundled Python Skill validator requires PyYAML, which is not installed. No personal KB or global Agent configuration was modified.

## JSON and errors

All operations support `--format json`: stdout is one versioned result or error object; diagnostics go to stderr. Exit codes: `0` success (including warnings), `2` invocation/config, `3` invalid data, `4` dependency, `5` write conflict/lock, `6` unsafe path/permission, `1` other failure.

## Current limits

- Link checks cover parsed inline/reference/image links, directory links, local sources and footnote/source IDs. Broken links remain quality warnings. External URLs/file URIs are not fetched, heading fragments and embedded HTML links are not checked, and unresolved reference syntax that Markdown parses as plain text is left as text.
- Bare source resources without path syntax may be population/scope descriptors under OKF and are not opened as files. An explicitly external local source should use a file URI; leading `/` paths mean Bundle-root paths.
- Lint checks structure and reports quality warnings; it does not authenticate an actor identity or prove factual accuracy.
- External editors do not honor AKB locks. Avoid parallel external writes; there are no multi-file transactions or snapshot-consistent searches.
- Markdown inputs are limited to 4 MiB, child output to 8 MiB, normal child execution to 15 seconds and QMD to 30 seconds. Large bundles may require a deliberate later change.
- Bundle reads/scans reject symlinks; Concept paths reject reserved files, hidden/control directories and casing collisions. QMD config/cache are user-owned trusted locations.
- No combined cross-KB search, team review mode, auto-navigation, advanced retrieval, batch maintenance, database, server or extra LLM key.

Design: [AKB_DESIGN.md](AKB_DESIGN.md). Format: [OKF v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Retrieval implementation: [QMD](https://github.com/tobi/qmd). Skill format: [Agent Skills](https://agentskills.io/specification).
