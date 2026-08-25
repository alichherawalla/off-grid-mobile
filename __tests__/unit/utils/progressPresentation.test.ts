import {
  formatByteRate,
  presentProgress,
} from '../../../src/utils/progressPresentation';

describe('Mobile progress presentation', () => {
  it('shows known bytes, live rate, and a finite percentage', () => {
    const result = presentProgress({
      bytesDownloaded: 5 * 1024 * 1024,
      totalBytes: 20 * 1024 * 1024,
      bytesPerSecond: 2.5 * 1024 * 1024,
      status: 'running',
    });

    expect(result.percentageText).toBe('25%');
    expect(result.bytesText).toBe('5 MB / 20 MB');
    expect(result.rateText).toBe('2.5 MB/s');
    expect(result.detailText).toBe('5 MB / 20 MB · 2.5 MB/s');
  });

  it('keeps an unknown total and rate honest without NaN', () => {
    const result = presentProgress({
      bytesDownloaded: 64,
      totalBytes: 0,
      bytesPerSecond: Number.NaN,
      progress: Number.POSITIVE_INFINITY,
      status: 'running',
    });

    expect(result.percentageText).toBeUndefined();
    expect(result.bytesText).toBe('64 B');
    expect(result.rateText).toBe('Rate unavailable');
    expect(result.detailText).toBe('64 B · Rate unavailable');
    expect(JSON.stringify(result)).not.toContain('NaN');
    expect(JSON.stringify(result)).not.toContain('Infinity');
  });

  it.each([
    ['completed', '100%'],
    ['failed', '30%'],
    ['cancelled', '30%'],
  ])('renders terminal %s progress without an active-only value', (status, expected) => {
    const result = presentProgress({
      bytesDownloaded: 300,
      totalBytes: 1_000,
      status,
    });
    expect(result.percentageText).toBe(expected);
    expect(result.progress.terminal).toBe(true);
  });

  it('never formats an invalid rate', () => {
    expect(formatByteRate(Number.NaN)).toBe('Rate unavailable');
    expect(formatByteRate(Number.POSITIVE_INFINITY)).toBe('Rate unavailable');
    expect(formatByteRate(-1)).toBe('Rate unavailable');
  });
});
