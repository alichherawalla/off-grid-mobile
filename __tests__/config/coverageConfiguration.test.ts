import packageManifest from '../../package.json';

const jestConfig = require('../../jest.config') as {
  collectCoverageFrom: string[];
  coverageThreshold?: Record<string, unknown>;
  testMatch: string[];
  testPathIgnorePatterns: string[];
};

describe('workspace coverage configuration', () => {
  it('uses one canonical Mobile command for core, Pro, Android, and iOS tests', () => {
    const command = packageManifest.scripts.test;

    expect(command).toBe(
      'npm run test:js && npm run test:android && npm run test:ios',
    );
    expect(command.match(/npm run test:js/g)).toHaveLength(1);
    expect(command).not.toContain('--prefix pro');
    expect(jestConfig.testMatch).toEqual([
      '**/__tests__/**/*.test.ts',
      '**/__tests__/**/*.test.tsx',
    ]);

    // Pro is part of the same Jest graph when the checked-out package exists. A
    // second Pro command would duplicate these suites and split the coverage SSOT.
    const proIsCheckedOut =
      jestConfig.collectCoverageFrom.includes('pro/**/*.{ts,tsx}');
    expect(proIsCheckedOut).toBe(true);
    const isIgnored = (testPath: string) =>
      jestConfig.testPathIgnorePatterns.some(pattern =>
        new RegExp(pattern).test(testPath),
      );
    expect(isIgnored('/workspace/mobile/__tests__/pro/example.test.ts')).toBe(
      false,
    );
    expect(isIgnored('/workspace/mobile/pro/__tests__/example.test.ts')).toBe(
      false,
    );
  });

  it('runs Mobile without force-exit and limits Shared coverage to Mobile consumers', () => {
    expect(packageManifest.scripts['test:js']).not.toContain('--forceExit');
    expect(packageManifest.scripts['test:js']).toContain('scripts/run-jest-shards.mjs');
    expect(packageManifest.scripts['test:js:shard']).toContain('jest --coverage --maxWorkers=1');
    expect(packageManifest.scripts['test:js:shard']).not.toContain('--forceExit');
    const command = packageManifest.scripts['test:coverage:workspace'];
    expect(command).not.toContain('--forceExit');
    expect(command).toMatch(/^npm run test:js &&/);
    expect(command).toContain('--consumers=mobile,mobile-pro');
  });

  it('measures core and Pro under one combined 80 percent threshold', () => {
    expect(jestConfig.collectCoverageFrom).toContain('pro/**/*.{ts,tsx}');
    expect(jestConfig.coverageThreshold).toMatchObject({
      global: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    });
    expect(jestConfig.coverageThreshold).not.toHaveProperty('./pro');
  });

  it('collects shard coverage without applying the aggregate threshold', () => {
    process.argv.push('--shard=1/10');
    jest.resetModules();
    try {
      const shardConfig = require('../../jest.config') as {
        coverageThreshold?: Record<string, unknown>;
      };
      expect(shardConfig.coverageThreshold).toBeUndefined();
    } finally {
      process.argv.pop();
      jest.resetModules();
    }
  });
});
