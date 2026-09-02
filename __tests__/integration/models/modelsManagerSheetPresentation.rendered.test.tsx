import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { ModelsManagerSheet } from '../../../src/components/models/ModelsManagerSheet';

describe('models manager sheet presentation', () => {
  const renderSheet = (input?: {
    labels?: { text: string; image: string; voice: string; speech: string };
    loadingState?: { isLoading: boolean; type?: string };
  }) =>
    render(
      <ModelsManagerSheet
        visible
        onClose={jest.fn()}
        labels={
          input?.labels ?? {
            text: 'Qwen 3.5',
            image: 'Flux',
            voice: 'Kokoro',
            speech: 'Whisper',
          }
        }
        loadingState={input?.loadingState ?? { isLoading: false }}
        isEjecting={false}
        hasActiveModel={false}
        onOpenRow={jest.fn()}
        onEject={jest.fn()}
      />,
    );

  it('presents a bounded viewport with every ready model row visible', async () => {
    const ui = renderSheet();

    await waitFor(() =>
      expect(ui.getByTestId('app-sheet-surface')).toBeTruthy(),
    );
    const sheetStyle = StyleSheet.flatten(
      ui.getByTestId('app-sheet-surface').props.style,
    );
    expect(sheetStyle.height).toBe(Dimensions.get('window').height * 0.55);
    expect(sheetStyle.maxHeight).toBeUndefined();
    for (const type of ['text', 'image', 'voice', 'speech']) {
      expect(ui.getByTestId(`models-row-${type}`)).toBeTruthy();
    }
  });

  it('keeps all rows visible while one model is loading', async () => {
    const ui = renderSheet({ loadingState: { isLoading: true, type: 'text' } });

    expect(await ui.findByText('Loading...')).toBeTruthy();
    for (const type of ['text', 'image', 'voice', 'speech']) {
      expect(ui.getByTestId(`models-row-${type}`)).toBeTruthy();
    }
  });

  it('shows the complete empty selection state instead of a blank sheet', async () => {
    const ui = renderSheet({
      labels: { text: '—', image: '—', voice: '—', speech: '—' },
    });

    expect(await ui.findAllByText('—')).toHaveLength(4);
    for (const type of ['text', 'image', 'voice', 'speech']) {
      expect(ui.getByTestId(`models-row-${type}`)).toBeTruthy();
    }
  });
});
