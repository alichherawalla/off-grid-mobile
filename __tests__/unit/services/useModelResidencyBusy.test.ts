import { renderHook, act } from '@testing-library/react-native';

const listeners = new Set<() => void>();
let busy = false;
jest.mock('../../../src/services/modelServices/residencyBootstrap', () => ({
  modelResidencyManager: {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isBusy: (modality: string) => modality === 'voice' && busy,
  },
}));

import { useModelResidencyBusy } from '../../../src/services/modelServices/useModelResidencyBusy';

describe('useModelResidencyBusy', () => {
  it('follows the shared residency manager for the asked modality', () => {
    const voice = renderHook(() => useModelResidencyBusy('voice'));
    const text = renderHook(() => useModelResidencyBusy('text'));
    expect(voice.result.current).toBe(false);
    act(() => {
      busy = true;
      listeners.forEach(listener => listener());
    });
    expect(voice.result.current).toBe(true);
    expect(text.result.current).toBe(false);
    act(() => {
      busy = false;
      listeners.forEach(listener => listener());
    });
    expect(voice.result.current).toBe(false);
  });
});
