/**
 * Unit tests for proPrompt.ts
 */

jest.mock('../../../src/stores/appStore', () => ({
  useAppStore: { getState: jest.fn() },
}));

import {
  shouldShowProAha,
  subscribeProPrompt,
  emitProPrompt,
  checkProPromptForText,
  checkProPromptForImage,
} from '../../../src/services/proPrompt';
import { useAppStore } from '../../../src/stores/appStore';

const mockedGetState = useAppStore.getState as jest.Mock;

function makeStore(overrides: any = {}) {
  return {
    hasRegisteredPro: false,
    isProActive: false,
    proAhaTriggeredBy: null,
    textGenerationCount: 10,
    imageGenerationCount: 10,
    setProAhaTriggeredBy: jest.fn(),
    ...overrides,
  };
}

describe('shouldShowProAha', () => {
  it('returns true at threshold (10)', () => {
    expect(shouldShowProAha(10)).toBe(true);
  });

  it('returns false below threshold', () => {
    expect(shouldShowProAha(2)).toBe(false);
    expect(shouldShowProAha(1)).toBe(false);
    expect(shouldShowProAha(9)).toBe(false);
  });

  it('returns false after the one automatic offer', () => {
    expect(shouldShowProAha(4)).toBe(false);
    expect(shouldShowProAha(11)).toBe(false);
    expect(shouldShowProAha(14)).toBe(false);
    expect(shouldShowProAha(15)).toBe(false);
    expect(shouldShowProAha(16)).toBe(false);
    expect(shouldShowProAha(24)).toBe(false);
    expect(shouldShowProAha(25)).toBe(false);
    expect(shouldShowProAha(35)).toBe(false);
  });
});

describe('subscribeProPrompt / emitProPrompt', () => {
  it('calls listener when emitted', () => {
    const listener = jest.fn();
    const unsub = subscribeProPrompt(listener);
    emitProPrompt('text');
    expect(listener).toHaveBeenCalledWith('text');
    unsub();
  });

  it('does not call listener after unsubscribe', () => {
    const listener = jest.fn();
    const unsub = subscribeProPrompt(listener);
    unsub();
    emitProPrompt('image');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('checkProPromptForText', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('skips when hasRegisteredPro=true', () => {
    const store = makeStore({ hasRegisteredPro: true });
    mockedGetState.mockReturnValue(store);
    checkProPromptForText(0);
    expect(store.setProAhaTriggeredBy).not.toHaveBeenCalled();
  });

  it('skips when isProActive=true (keychain/dev-unlocked Pro user, never registered)', () => {
    const store = makeStore({ hasRegisteredPro: false, isProActive: true });
    mockedGetState.mockReturnValue(store);
    checkProPromptForText(0);
    expect(store.setProAhaTriggeredBy).not.toHaveBeenCalled();
  });

  it('skips when proAhaTriggeredBy is already set', () => {
    const store = makeStore({ proAhaTriggeredBy: 'text' });
    mockedGetState.mockReturnValue(store);
    checkProPromptForText(0);
    expect(store.setProAhaTriggeredBy).not.toHaveBeenCalled();
  });

  it('skips when count does not meet threshold', () => {
    const store = makeStore({ textGenerationCount: 1 });
    mockedGetState.mockReturnValue(store);
    checkProPromptForText(0);
    expect(store.setProAhaTriggeredBy).not.toHaveBeenCalled();
  });

  it('triggers when all conditions met', () => {
    const store = makeStore({ textGenerationCount: 10 });
    mockedGetState.mockReturnValue(store);
    checkProPromptForText(0);
    expect(store.setProAhaTriggeredBy).toHaveBeenCalledWith('text');
  });
});

describe('checkProPromptForImage', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('triggers for image when count meets threshold', () => {
    const store = makeStore({ imageGenerationCount: 10 });
    mockedGetState.mockReturnValue(store);
    checkProPromptForImage(0);
    expect(store.setProAhaTriggeredBy).toHaveBeenCalledWith('image');
  });

  it('skips when hasRegisteredPro=true', () => {
    const store = makeStore({ hasRegisteredPro: true, imageGenerationCount: 10 });
    mockedGetState.mockReturnValue(store);
    checkProPromptForImage(0);
    expect(store.setProAhaTriggeredBy).not.toHaveBeenCalled();
  });
});
