/**
 * useModelLoading Hook Unit Tests
 *
 * Selecting a model only MARKS it active (no eager load); the load is deferred
 * to the first message in chat. Unload still tears down immediately.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useModelLoading } from '../../../src/screens/HomeScreen/hooks/useModelLoading';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSelectMobileModel = jest.fn().mockResolvedValue(undefined);
const mockUnloadTextModel = jest.fn().mockResolvedValue(undefined);
const mockUnloadImageModel = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/services', () => ({
  selectMobileModel: (...args: any[]) => mockSelectMobileModel(...args),
  unloadTextModel: (...args: any[]) => mockUnloadTextModel(...args),
  unloadImageModel: (...args: any[]) => mockUnloadImageModel(...args),
}));

jest.mock('../../../src/components', () => ({
  showAlert: jest.fn((title: string, message: string, buttons?: any[]) => ({
    visible: true, title, message, buttons: buttons ?? [],
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeImageModel(overrides: Partial<any> = {}): any {
  return { id: 'img-1', name: 'SDXL', ...overrides };
}

function makeSetters() {
  return {
    setLoadingState: jest.fn(),
    setPickerType: jest.fn(),
    setAlertState: jest.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useModelLoading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleSelectTextModel', () => {
    // (Removed: asserted the hook writes activeModelId directly via setActiveModelId. The single-owner
    // migration (f540bf76) moved that write into activeModelService.selectTextModel — the hook now
    // dispatches the select intent, so the store-setter mock is no longer the writer. Selection making
    // a model active (without eager load) is covered by the rendered model-selection integration tests.)
  });

  describe('handleSelectImageModel', () => {
    it('marks the image model active without loading it', async () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        await result.current.handleSelectImageModel(makeImageModel());
      });

      expect(mockSelectMobileModel).toHaveBeenCalledWith({
        source: 'local',
        hostId: 'image-runtime',
        modality: 'image',
        modelId: 'img-1',
      });
      expect(setters.setPickerType).toHaveBeenCalledWith(null);
    });
  });

  describe('handleUnloadTextModel', () => {
    it('unloads text model and resets loading state', async () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadTextModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(mockUnloadTextModel).toHaveBeenCalled();
    });

    it('shows error alert when unload throws', async () => {
      mockUnloadTextModel.mockRejectedValueOnce(new Error('fail'));
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadTextModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(setters.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
    });
  });

  describe('handleUnloadImageModel', () => {
    it('unloads image model', async () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadImageModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(mockUnloadImageModel).toHaveBeenCalled();
    });
  });
});
