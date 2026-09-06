/**
 * SharePromptSheet Component Tests
 *
 * Tests for the share/star prompt bottom sheet.
 * Priority: P1 (High)
 */

import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SharePromptSheet } from '../../../src/components/SharePromptSheet';
import { useAppStore } from '../../../src/stores/appStore';
import { GITHUB_URL } from '../../../src/utils/sharePrompt';

jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);

// Either store's label is right - which one renders depends on the platform the suite runs as.
const RATE_LABEL = /^Rate on (the App Store|Google Play)$/;
jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);

function renderSheet(onClose = jest.fn()) {
  const result = render(<SharePromptSheet visible={true} onClose={onClose} />);
  return { ...result, onClose };
}

describe('SharePromptSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ hasEngagedSharePrompt: false });
  });

  it('renders message, support actions, and both dismissal choices', () => {
    const { getByText } = renderSheet();
    expect(getByText(/Off Grid AI is completely free/)).toBeTruthy();
    expect(getByText('Star on GitHub')).toBeTruthy();
    expect(getByText(RATE_LABEL)).toBeTruthy();
    expect(getByText('Maybe later')).toBeTruthy();
    expect(getByText("Don't show again")).toBeTruthy();
  });

  it('opens GitHub URL, marks engaged, and closes on Star press', () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText('Star on GitHub'));
    expect(Linking.openURL).toHaveBeenCalledWith(GITHUB_URL);
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(true);
  });

  it('opens this platform store to rate, marks engaged, and closes on press', async () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText(RATE_LABEL));
    // Engagement + close are synchronous; opening the store resolves on the next tick.
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(true);
    await waitFor(() => {
      // Whichever store this platform has - never the other one's.
      expect(Linking.openURL).toHaveBeenCalledWith(
        expect.stringMatching(/^(https:\/\/apps\.apple\.com\/app\/id|market:\/\/details|https:\/\/play\.google\.com\/store)/),
      );
    });
  });

  it('closes without marking engaged on Maybe later press', () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText('Maybe later'));
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(false);
  });

  it("persists the dismissal and closes on Don't show again press", () => {
    const { getByText, onClose } = renderSheet();
    fireEvent.press(getByText("Don't show again"));
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().hasEngagedSharePrompt).toBe(true);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
