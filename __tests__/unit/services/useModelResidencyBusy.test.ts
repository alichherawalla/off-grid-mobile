import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useModelResidencyBusy } from '../../../src/services/modelServices/useModelResidencyBusy';
import { llmService } from '../../../src/services/llm';
import { useAppStore } from '../../../src/stores/appStore';
import {
  modelApplication,
  resetModelApplication,
} from '../../harness/activeModelLifecycle';
import { createDownloadedModel } from '../../utils/factories';

describe('useModelResidencyBusy', () => {
  it('projects a real facade load only to the affected modality', async () => {
    let finishLoad: (() => void) | undefined;
    let loaded = false;
    jest.spyOn(llmService, 'loadModel').mockImplementation(
      () => new Promise<void>(resolve => {
        finishLoad = () => {
          loaded = true;
          resolve();
        };
      }),
    );
    jest.spyOn(llmService, 'isModelLoaded').mockImplementation(() => loaded);
    await resetModelApplication();
    useAppStore.getState().addDownloadedModel(createDownloadedModel({id: 'busy-text'}));
    await modelApplication().models.refresh();
    const selected = await modelApplication().models.select({
      modality: 'text',
      modelId: 'busy-text',
    });
    expect(selected.ok).toBe(true);

    const text = renderHook(() => useModelResidencyBusy('text'));
    const voice = renderHook(() => useModelResidencyBusy('voice'));
    let loading!: Promise<unknown>;
    act(() => {
      loading = modelApplication().models.load({modality: 'text', modelId: 'busy-text'});
    });

    await waitFor(() => expect(text.result.current).toBe(true));
    expect(voice.result.current).toBe(false);
    finishLoad?.();
    await act(async () => { await loading; });
    await waitFor(() => expect(text.result.current).toBe(false));
  });
});
