import packageManifest from '../../package.json';

const { proCoverageThreshold } = require('../../scripts/jestCoverageThresholds') as {
  proCoverageThreshold(exists: boolean): Record<string, unknown>;
};

describe('workspace coverage configuration', () => {
  it('runs Mobile without force-exit and limits Shared coverage to Mobile consumers', () => {
    const command = packageManifest.scripts['test:coverage:workspace'];
    expect(command).not.toContain('--forceExit');
    expect(command).toContain('--consumers=mobile,mobile-pro');
  });

  it('adds the Pro threshold only when Pro source exists', () => {
    expect(proCoverageThreshold(false)).toEqual({});
    expect(proCoverageThreshold(true)).toEqual({
      './pro': {
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
      },
    });
  });
});
