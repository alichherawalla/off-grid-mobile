/**
 * SecuritySettingsScreen Tests
 *
 * Tests for the security settings screen including:
 * - Title display
 * - App Lock section
 * - Back button navigation
 * - Passphrase toggle (enable/disable)
 * - Change passphrase button
 * - Info card
 * - Passphrase setup modal
 */

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';

// Navigation is globally mocked in jest.setup.ts
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({
      params: {},
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

import { SecuritySettingsScreen } from '../../../src/screens/SecuritySettingsScreen';
import { useAuthStore } from '../../../src/stores/authStore';

describe('SecuritySettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => useAuthStore.getState().setEnabled(false));
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders "Security" title', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(getByText('Security')).toBeTruthy();
    });

    it('shows App Lock section', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(getByText('App Lock')).toBeTruthy();
      expect(getByText('Passphrase Lock')).toBeTruthy();
      expect(getByText('Require passphrase to open app')).toBeTruthy();
    });

    it('back button calls goBack', () => {
      const { UNSAFE_getAllByType } = render(<SecuritySettingsScreen />);
      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // The first TouchableOpacity is the back button
      fireEvent.press(touchables[0]);
      expect(mockGoBack).toHaveBeenCalled();
    });

    it('shows info card about passphrase behavior', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(
        getByText(/the app will lock automatically/i)
      ).toBeTruthy();
    });

    it('shows info about passphrase being stored on device', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(
        getByText(/stored securely on device and never transmitted/i)
      ).toBeTruthy();
    });
  });

  // ============================================================================
  // Passphrase Toggle - Enable
  // ============================================================================
  describe('passphrase toggle - enable', () => {
    it('switch defaults to off when auth not enabled', () => {
      const { getAllByRole } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');
      expect(switches.length).toBeGreaterThan(0);
      // The switch renders the real store state.
      expect(switches[0].props.value).toBe(false);
    });

    it('opens passphrase setup when toggling on', () => {
      const { getAllByRole, getByText, queryByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      // Initially no passphrase setup shown
      expect(queryByText('Set Up Passphrase')).toBeNull();

      // Toggle switch on
      fireEvent(switches[0], 'valueChange', true);

      // Passphrase setup modal should appear
      expect(getByText('Set Up Passphrase')).toBeTruthy();
    });

    it('shows "Set Up Passphrase" when enabling rather than the change flow', () => {
      const { getAllByRole, getByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      fireEvent(switches[0], 'valueChange', true);

      expect(getByText('Set Up Passphrase')).toBeTruthy();
    });
  });

  // ============================================================================
  // Passphrase Toggle - Disable
  // ============================================================================
  describe('passphrase toggle - disable', () => {
    beforeEach(() => {
      act(() => useAuthStore.getState().setEnabled(true));
    });

    it('switch shows on when auth is enabled', () => {
      const { getAllByRole } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');
      expect(switches[0].props.value).toBe(true);
    });

    it('shows confirmation alert when toggling off', () => {
      const { getAllByRole, getByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      fireEvent(switches[0], 'valueChange', false);

      // Should show the alert asking to confirm disabling
      expect(getByText('Disable Passphrase Lock')).toBeTruthy();
    });

    it('shows confirmation alert with Disable and Cancel buttons', () => {
      const { getAllByRole, getByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      // Toggle off to trigger the confirmation alert
      fireEvent(switches[0], 'valueChange', false);

      // Alert should be visible with correct title and buttons
      expect(getByText('Disable Passphrase Lock')).toBeTruthy();
      expect(getByText('Disable')).toBeTruthy();
      expect(getByText('Cancel')).toBeTruthy();
    });

    it('does not disable auth when cancelled', () => {
      const { getAllByRole, getByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      fireEvent(switches[0], 'valueChange', false);

      // Press "Cancel" button in alert
      fireEvent.press(getByText('Cancel'));

      // Should NOT call removePassphrase
      expect(useAuthStore.getState().isEnabled).toBe(true);
      expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Change Passphrase
  // ============================================================================
  describe('change passphrase', () => {
    beforeEach(() => {
      act(() => useAuthStore.getState().setEnabled(true));
    });

    it('shows "Change Passphrase" button when auth is enabled', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(getByText('Change Passphrase')).toBeTruthy();
    });

    it('does not show "Change Passphrase" button when auth is disabled', () => {
      act(() => useAuthStore.getState().setEnabled(false));
      const { queryByText } = render(<SecuritySettingsScreen />);
      expect(queryByText('Change Passphrase')).toBeNull();
    });

    it('opens passphrase setup in change mode when button is pressed', () => {
      const { getByText } = render(<SecuritySettingsScreen />);

      fireEvent.press(getByText('Change Passphrase'));

      expect(getByText('Enter your current passphrase and then set a new one.')).toBeTruthy();
    });
  });

  // ============================================================================
  // Passphrase Setup Modal Interactions
  // ============================================================================
  describe('passphrase setup modal', () => {
    it('closes passphrase setup on complete', async () => {
      const { getAllByRole, queryByText, getByPlaceholderText, getByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      // Open setup
      fireEvent(switches[0], 'valueChange', true);
      expect(getByText('Set Up Passphrase')).toBeTruthy();

      fireEvent.changeText(getByPlaceholderText('Enter passphrase (min 6 characters)'), 'secret1');
      fireEvent.changeText(getByPlaceholderText('Re-enter passphrase'), 'secret1');
      fireEvent.press(getByText('Enable Lock'));

      await waitFor(() => expect(queryByText('Set Up Passphrase')).toBeNull());
      expect(useAuthStore.getState().isEnabled).toBe(true);
    });

    it('closes passphrase setup on cancel', () => {
      const { getAllByRole, queryByText, getByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      // Open setup
      fireEvent(switches[0], 'valueChange', true);
      expect(getByText('Set Up Passphrase')).toBeTruthy();

      fireEvent.press(getByText('Cancel'));
      expect(queryByText('Set Up Passphrase')).toBeNull();
    });
  });
});
