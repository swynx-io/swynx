#!/usr/bin/env node
// Swynx regression test suite.
// Each directory under test/fixtures/ containing an expected.json is scanned
// with `swynx scan --format json` and the output is checked against it.
//
// expected.json fields (all optional):
//   deadFiles          [paths]                — must be reported as unused files
//   notDeadFiles       [paths]                — must NOT be reported as unused files
//   deadFunctions      [{file, name}]         — must be reported as unused functions
//   notDeadFunctions   [names]                — must NOT appear as unused functions
//   unusedExports      [{file, name}]         — must be reported as unused exports
//   notUnusedExports   [names]                — must NOT appear as unused exports

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturesDir = join(root, 'test', 'fixtures');
const swynxBin = join(root, 'bin', 'swynx');

let passed = 0;
let failed = 0;
const failures = [];

function check(fixture, condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(`${fixture}: ${message}`);
  }
}

const fixtures = readdirSync(fixturesDir, { withFileTypes: true })
  .filter(e => e.isDirectory() && existsSync(join(fixturesDir, e.name, 'expected.json')))
  .map(e => e.name)
  .sort();

if (fixtures.length === 0) {
  console.error('No fixtures with expected.json found under test/fixtures/');
  process.exit(1);
}

for (const name of fixtures) {
  const fixturePath = join(fixturesDir, name);
  const expected = JSON.parse(readFileSync(join(fixturePath, 'expected.json'), 'utf-8'));

  let result;
  try {
    const stdout = execFileSync(process.execPath, [swynxBin, 'scan', fixturePath, '--format', 'json', '--no-cache'], {
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    result = JSON.parse(stdout);
  } catch (err) {
    failed++;
    failures.push(`${name}: scan failed — ${err.message.split('\n')[0]}`);
    continue;
  }

  const deadFilePaths = (result.unusedFiles || []).map(f => f.path);
  const deadFns = result.unusedFunctions || [];
  const deadFnNames = deadFns.map(f => f.name);
  const unusedExports = (result.unusedExports || []).flatMap(e => e.deadExports.map(x => ({ file: e.file, name: x.name })));
  const unusedExportNames = unusedExports.map(e => e.name);

  for (const path of expected.deadFiles || []) {
    check(name, deadFilePaths.includes(path), `expected dead file "${path}" not reported (got: ${JSON.stringify(deadFilePaths)})`);
  }
  for (const path of expected.notDeadFiles || []) {
    check(name, !deadFilePaths.includes(path), `false positive: live file "${path}" reported dead`);
  }
  for (const fn of expected.deadFunctions || []) {
    check(name, deadFns.some(f => f.file === fn.file && f.name === fn.name),
      `expected dead function ${fn.file}:${fn.name} not reported (got: ${JSON.stringify(deadFns.map(f => `${f.file}:${f.name}`))})`);
  }
  for (const fnName of expected.notDeadFunctions || []) {
    check(name, !deadFnNames.includes(fnName), `false positive: live function "${fnName}" reported dead`);
  }
  for (const exp of expected.unusedExports || []) {
    check(name, unusedExports.some(e => e.file === exp.file && e.name === exp.name),
      `expected unused export ${exp.file}:${exp.name} not reported (got: ${JSON.stringify(unusedExports)})`);
  }
  for (const expName of expected.notUnusedExports || []) {
    check(name, !unusedExportNames.includes(expName), `false positive: live export "${expName}" reported unused`);
  }

  console.log(`  ${name}: done`);
}

console.log('');
console.log(`${passed} checks passed, ${failed} failed across ${fixtures.length} fixtures`);
if (failures.length > 0) {
  console.log('');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
