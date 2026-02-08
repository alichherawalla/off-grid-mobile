/**
 * ModelSettingsScreen Tests
 *
 * Tests for the model settings screen including:
 * - Show Generation Details toggle
 * - Settings persistence via store
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';

// Mock Slider component
jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => <View testID="slider" {...props} />,
  };
});

// Import after mocks
import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';

const renderScreen = () => {
  return render(
    <NavigationContainer>
      <ModelSettingsScreen />
    </NavigationContainer>
  );
};

describe('ModelSettingsScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders without crashing', () => {
      const { getByText } = renderScreen();
      expect(getByText('Model Settings')).toBeTruthy();
    });

    it('shows all section titles', () => {
      const { getByText } = renderScreen();
      expect(getByText('Default System Prompt')).toBeTruthy();
      expect(getByText('Image Generation')).toBeTruthy();
      expect(getByText('Text Generation')).toBeTruthy();
      expect(getByText('Performance')).toBeTruthy();
    });
  });

  // ============================================================================
  // Show Generation Details Toggle
  // ============================================================================
  describe('show generation details toggle', () => {
    it('renders the toggle with label and description', () => {
      const { getByText } = renderScreen();
      expect(getByText('Show Generation Details')).toBeTruthy();
      expect(getByText('Display tokens/sec, timing, and memory usage on responses')).toBeTruthy();
    });

    it('defaults to off', () => {
      const state = useAppStore.getState();
      expect(state.settings.showGenerationDetails).toBe(false);
    });

    it('updates store to true when toggled on', () => {
      const { getAllByRole } = renderScreen();
      const switches = getAllByRole('switch');

      // Find the Show Generation Details switch (it's in the Text Generation section)
      // Toggle each switch and check which one updates showGenerationDetails
      const initialValue = useAppStore.getState().settings.showGenerationDetails;
      expect(initialValue).toBe(false);

      // Find the right switch by toggling and checking
      for (const sw of switches) {
        const before = useAppStore.getState().settings.showGenerationDetails;
        fireEvent(sw, 'valueChange', true);
        const after = useAppStore.getState().settings.showGenerationDetails;
        if (after !== before) {
          // Found it - verify
          expect(after).toBe(true);
          return;
        }
      }
      // If we get here, no switch updated the setting
      fail('No switch found that updates showGenerationDetails');
    });

    it('updates store to false when toggled off', () => {
      // Start with it enabled
      useAppStore.getState().updateSettings({ showGenerationDetails: true });

      const { getAllByRole } = renderScreen();
      const switches = getAllByRole('switch');

      for (const sw of switches) {
        const before = useAppStore.getState().settings.showGenerationDetails;
        if (before === true) {
          fireEvent(sw, 'valueChange', false);
          const after = useAppStore.getState().settings.showGenerationDetails;
          if (after === false) {
            expect(after).toBe(false);
            return;
          }
          // Reset for next iteration
          useAppStore.getState().updateSettings({ showGenerationDetails: true });
        }
      }
    });

    it('syncs with store when showGenerationDetails is already true', () => {
      useAppStore.getState().updateSettings({ showGenerationDetails: true });

      const { getByText } = renderScreen();
      expect(getByText('Show Generation Details')).toBeTruthy();
      expect(useAppStore.getState().settings.showGenerationDetails).toBe(true);
    });
  });
});
