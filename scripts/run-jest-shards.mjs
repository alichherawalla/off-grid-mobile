#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const { createContext } = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const jestConfig = require('../jest.config.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const COVERAGE_ROOT = path.join(ROOT, 'coverage-shards');
const FINAL_COVERAGE = path.join(ROOT, 'coverage');

export function recommendedShardCount(availableCpus = os.availableParallelism()) {
  if (!Number.isInteger(availableCpus) || availableCpus < 1) {
    throw new Error('availableCpus must be a positive integer.');
  }
  // A shard owns one serial Jest worker. React Native transforms are memory
  // intensive, so reserve two cores and cap concurrency below the point where
  // unrelated rendered journeys begin missing their normal timing bounds.
  return Math.max(1, Math.min(6, availableCpus - 2));
}

export function resolveShardCount(
  value = process.env.MOBILE_JEST_SHARDS,
  availableCpus = os.availableParallelism(),
) {
  if (value === undefined || value === '') return recommendedShardCount(availableCpus);
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error('MOBILE_JEST_SHARDS must be an integer from 1 through 12.');
  }
  return count;
}

export function coverageFailures(coverageMap, thresholds, root = ROOT) {
  const failures = [];
  const specificFiles = new Set();
  const metricNames = ['statements', 'branches', 'functions', 'lines'];
  const relativeName = file => `./${path.relative(root, file).split(path.sep).join('/')}`;

  for (const [filePattern, gate] of Object.entries(thresholds ?? {})) {
    if (filePattern === 'global') continue;
    if (/[*?{}[\]]/.test(filePattern)) {
      failures.push(`Unsupported coverage threshold pattern: ${filePattern}`);
      continue;
    }
    const match = coverageMap.files().find(file => relativeName(file) === filePattern);
    if (!match) {
      failures.push(`${filePattern}: no coverage data was produced`);
      continue;
    }
    specificFiles.add(match);
    const summary = coverageMap.fileCoverageFor(match).toSummary().toJSON();
    for (const metric of metricNames) {
      const minimum = gate?.[metric];
      if (typeof minimum === 'number' && summary[metric].pct < minimum) {
        failures.push(`${filePattern} ${metric}: ${summary[metric].pct}% is below ${minimum}%`);
      }
    }
  }

  const globalMap = createCoverageMap({});
  for (const file of coverageMap.files()) {
    if (!specificFiles.has(file)) globalMap.addFileCoverage(coverageMap.fileCoverageFor(file));
  }
  const globalSummary = globalMap.getCoverageSummary().toJSON();
  for (const metric of metricNames) {
    const minimum = thresholds?.global?.[metric];
    if (typeof minimum === 'number' && globalSummary[metric].pct < minimum) {
      failures.push(`global ${metric}: ${globalSummary[metric].pct}% is below ${minimum}%`);
    }
  }
  return failures;
}

function prefixStream(stream, prefix, destination, logStream) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    logStream.write(chunk);
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) destination.write(`${prefix} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (pending.trim()) destination.write(`${prefix} ${pending}\n`);
  });
}

function runShard(index, total, extraArgs = []) {
  const coverageDirectory = path.join(COVERAGE_ROOT, `shard-${index}`);
  const logPath = path.join(COVERAGE_ROOT, `shard-${index}.log`);
  const logStream = fs.createWriteStream(logPath);
  const jestBin = require.resolve('jest/bin/jest');
  const args = [
    jestBin,
    '--coverage',
    '--maxWorkers=1',
    `--shard=${index}/${total}`,
    `--coverageDirectory=${coverageDirectory}`,
    '--coverageReporters=json',
    '--silent',
    '--verbose',
    ...extraArgs,
  ];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      JEST_COVERAGE_COLLECTION_SHARD: '1',
      NODE_OPTIONS: `--max-old-space-size=${process.env.MOBILE_JEST_SHARD_HEAP_MB ?? '2048'}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  prefixStream(child.stdout, `[mobile ${index}/${total}]`, process.stdout, logStream);
  prefixStream(child.stderr, `[mobile ${index}/${total}]`, process.stderr, logStream);
  return new Promise(resolve => {
    child.once('error', error => {
      logStream.end();
      resolve({ index, ok: false, error, logPath });
    });
    child.once('exit', (code, signal) => {
      logStream.end();
      resolve({
        index,
        ok: code === 0,
        error: code === 0 ? null : new Error(`exited ${code ?? signal}`),
        logPath,
      });
    });
  });
}

function mergeCoverage(shardCount) {
  const coverageMap = createCoverageMap({});
  for (let index = 1; index <= shardCount; index += 1) {
    const reportPath = path.join(COVERAGE_ROOT, `shard-${index}`, 'coverage-final.json');
    if (!fs.existsSync(reportPath)) throw new Error(`Shard ${index} did not produce coverage.`);
    coverageMap.merge(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
  }
  fs.rmSync(FINAL_COVERAGE, { recursive: true, force: true });
  fs.mkdirSync(FINAL_COVERAGE, { recursive: true });
  const context = createContext({ dir: FINAL_COVERAGE, coverageMap });
  for (const reporter of ['json', 'json-summary', 'lcov', 'html', 'text-summary']) {
    reports.create(reporter).execute(context);
  }
  return coverageMap;
}

export async function run({ shardCount = resolveShardCount(), extraArgs = process.argv.slice(2) } = {}) {
  fs.rmSync(COVERAGE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(COVERAGE_ROOT, { recursive: true });
  process.stdout.write(
    `[mobile] running ${shardCount} isolated Jest shards; each shard remains serial\n`,
  );
  const results = await Promise.all(
    Array.from({ length: shardCount }, (_, offset) => runShard(offset + 1, shardCount, extraArgs)),
  );
  for (const result of results) {
    process.stdout.write(
      `[mobile ${result.index}/${shardCount}] ${result.ok ? 'passed' : 'failed'} · full log: ${result.logPath}\n`,
    );
  }

  let coverageMap;
  try {
    coverageMap = mergeCoverage(shardCount);
  } catch (error) {
    process.stderr.write(`[mobile] coverage merge failed: ${error.message}\n`);
    return 1;
  }
  const gateFailures = coverageFailures(coverageMap, jestConfig.coverageThreshold);
  for (const failure of gateFailures) process.stderr.write(`[mobile] coverage gate failed: ${failure}\n`);
  return results.every(result => result.ok) && gateFailures.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run();
}
