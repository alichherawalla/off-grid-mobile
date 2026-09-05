import packageManifest from '../../package.json';

const jestConfig = require('../../jest.config') as {
  collectCoverageFrom: string[];
  coverageThreshold: Record<string, unknown>;
};

describe('workspace coverage configuration', () => {
  it('runs Mobile without force-exit and limits Shared coverage to Mobile consumers', () => {
    expect(packageManifest.scripts['test:js']).not.toContain('--forceExit');
    const command = packageManifest.scripts['test:coverage:workspace'];
    expect(command).not.toContain('--forceExit');
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
});
