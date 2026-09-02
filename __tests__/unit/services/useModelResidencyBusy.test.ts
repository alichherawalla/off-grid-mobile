import { renderHook, act } from '@testing-library/react-native';

jest.mock('../../../src/services/modelServices/residencyBootstrap', () => {
  const listeners = new Set<() => void>();
  const state = { busy: false };
  return {
    modelResidencyManager: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isBusy: (modality: string) => modality === 'voice' && state.busy,
    },
    __test: {
      setBusy: (value: boolean) => {
        state.busy = value;
        listeners.forEach(listener => listener());
      },
    },
  };
});

import { useModelResidencyBusy } from '../../../src/services/modelServices/useModelResidencyBusy';
import * as residency from '../../../src/services/modelServices/residencyBootstrap';

const setBusy = (residency as unknown as { __test: { setBusy: (value: boolean) => void } }).__test.setBusy;

describe('useModelResidencyBusy', () => {
  it('follows the shared residency manager for the asked modality', () => {
    const voice = renderHook(() => useModelResidencyBusy('voice'));
    const text = renderHook(() => useModelResidencyBusy('text'));
    expect(voice.result.current).toBe(false);
    act(() => setBusy(true));
    expect(voice.result.current).toBe(true);
    expect(text.result.current).toBe(false);
    act(() => setBusy(false));
    expect(voice.result.current).toBe(false);
  });
});
