import packageManifest from '../../package.json';

const jestConfig = require('../../jest.config') as {
  collectCoverageFrom: string[];
  coverageThreshold?: Record<string, unknown>;
};

describe('workspace coverage configuration', () => {
  it('runs Mobile without force-exit and limits Shared coverage to Mobile consumers', () => {
    expect(packageManifest.scripts['test:js']).not.toContain('--forceExit');
    expect(packageManifest.scripts['test:js:shard']).toBe('npm run test:js --');
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
