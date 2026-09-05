import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coverageFailures,
  recommendedShardCount,
  resolveShardCount,
} from '../run-jest-shards.mjs';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const metroConfig = require('../../metro.config.js');
const packageManifest = require('../../package.json');
const applicationManifest = require('../../../shared/packages/application/package.json');
const babelConfig = require('../../babel.config.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const fileCoverage = (relativePath, hits) => ({
  path: path.join(ROOT, relativePath),
  statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
  fnMap: { 0: { name: 'f', decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } } },
  branchMap: { 0: { type: 'if', locations: [{ start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }] } },
  s: { 0: hits },
  f: { 0: hits },
  b: { 0: [hits] },
});

test('uses available CPU safely by default and rejects unsafe overrides', () => {
  assert.equal(recommendedShardCount(10), 6);
  assert.equal(recommendedShardCount(4), 2);
  assert.equal(recommendedShardCount(2), 1);
  assert.equal(resolveShardCount(undefined, 10), 6);
  assert.equal(resolveShardCount('6'), 6);
  assert.throws(() => resolveShardCount('0'));
  assert.throws(() => resolveShardCount('many'));
  assert.throws(() => recommendedShardCount(0));
});

test('maps the Mobile and application-facade Shared dependencies into the Metro release graph', () => {
  const mappings = metroConfig.resolver?.extraNodeModules ?? {};
  const watched = new Set((metroConfig.watchFolders ?? []).map(directory => path.resolve(directory)));
  const directDependencies = Object.entries(packageManifest.dependencies)
    .filter(([name, location]) => name.startsWith('@offgrid/') && String(location).startsWith('file:../shared/packages/'))
    .map(([name, location]) => [name, path.resolve(ROOT, String(location).slice('file:'.length))]);
  const facadeDependencies = Object.keys(applicationManifest.dependencies)
    .filter(name => name.startsWith('@offgrid/'))
    .map(name => [name, path.resolve(ROOT, '../shared/packages', name.slice('@offgrid/'.length))]);

  for (const [name, packageDirectory] of [...directDependencies, ...facadeDependencies]) {
    assert.ok(mappings[name], `${name} must have an explicit Metro mapping`);
    assert.ok(watched.has(packageDirectory), `${name} must be watched by Metro`);
  }
});

test('transforms dependency namespace exports before Metro converts modules', () => {
  assert.ok(babelConfig.plugins.includes('@babel/plugin-transform-export-namespace-from'));
});

test('applies exact-file gates separately from the global product gate', () => {
  const map = createCoverageMap({});
  map.addFileCoverage(fileCoverage('src/core.ts', 1));
  map.addFileCoverage(fileCoverage('src/exact.ts', 0));
  const failures = coverageFailures(map, {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/exact.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
  }, ROOT);
  assert.deepEqual(failures, [
    './src/exact.ts statements: 0% is below 100%',
    './src/exact.ts branches: 0% is below 100%',
    './src/exact.ts functions: 0% is below 100%',
    './src/exact.ts lines: 0% is below 100%',
  ]);
});

test('fails closed when a file-specific coverage owner disappears', () => {
  const map = createCoverageMap({});
  map.addFileCoverage(fileCoverage('src/core.ts', 1));
  assert.deepEqual(
    coverageFailures(map, { global: {}, './src/missing.ts': { lines: 100 } }, ROOT),
    ['./src/missing.ts: no coverage data was produced'],
  );
});
