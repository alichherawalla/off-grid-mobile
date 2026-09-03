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

  it('sizes to its rows (no fixed height, bounded by the screen) with every ready model row visible', async () => {
    const ui = renderSheet();

    await waitFor(() =>
      expect(ui.getByTestId('app-sheet-surface')).toBeTruthy(),
    );
    const sheetStyle = StyleSheet.flatten(
      ui.getByTestId('app-sheet-surface').props.style,
    );
    // The sheet has no fixed height: it takes the height of its rows and is only capped by the screen,
    // so there is no empty space below the last row.
    expect(sheetStyle.height).toBeUndefined();
    expect(sheetStyle.maxHeight).toBeLessThanOrEqual(Dimensions.get('window').height);
    expect(sheetStyle.maxHeight).toBeGreaterThan(0);
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
