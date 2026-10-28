#!/usr/bin/env bash
set -euo pipefail

test "$(uname -s)" = Linux
npm run build
AKB_TEST_QMD=1 node node_modules/vitest/vitest.mjs run \
  --reporter=default --reporter=json --outputFile=/results/tests.json
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const result=JSON.parse(readFileSync('/results/tests.json','utf8'));
assert.equal(result.success,true);
assert.equal(result.numPendingTests,0,'Linux verification must not skip real QMD tests');
assert.ok(result.numTotalTests>=43,'Expected the full AKB test suite');
JS
mkdir -p /tmp/akb-release /tmp/akb-installed
npm pack --silent --pack-destination /tmp/akb-release
npm install --prefix /tmp/akb-installed /tmp/akb-release/agent-knowledge-base-0.1.0.tgz \
  --ignore-scripts --no-audit --no-fund
node scripts/installed-smoke.mjs /tmp/akb-installed/node_modules/.bin/akb /results/smoke.json
