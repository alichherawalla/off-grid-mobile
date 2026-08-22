import { settleWithinBudget } from '../../../pro/sync/licenceRevalidationBudget';

describe('licence revalidation startup budget', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('releases the budget timer when revalidation finishes first', async () => {
    await settleWithinBudget(Promise.resolve(), 3_000);

    expect(jest.getTimerCount()).toBe(0);
  });

  it('continues when the budget finishes before revalidation', async () => {
    const pendingOperation = new Promise<void>(() => undefined);
    const result = settleWithinBudget(pendingOperation, 3_000);

    await jest.advanceTimersByTimeAsync(3_000);
    await expect(result).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
