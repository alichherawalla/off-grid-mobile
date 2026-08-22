/**
 * The Pro pitch has one purchase path and one key-entry path. A second action that offered to use
 * another device's licence duplicated the Sync journey and made the purchase screen ambiguous.
 *
 * This test enters through the real Home screen and real app navigation. Native rendering remains
 * supplied by the Jest environment, but every Off Grid screen, store action, and route is real.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import { useAppStore } from '../../../src/stores/appStore';
import { createDeviceInfo, createDownloadedModel } from '../../utils/factories';

describe('Pro entry from Home', () => {
  beforeEach(() => {
    const model = createDownloadedModel();
    const app = useAppStore.getState();

    // Use the production store actions to restore a returning user's local app state. The behavior
    // under test starts with their real Home-screen gesture below.
    app.setOnboardingComplete(true);
    app.setDeviceInfo(createDeviceInfo());
    app.setDownloadedModels([model]);
    app.setActiveModelId(model.id);
  });

  afterEach(() => {
    const app = useAppStore.getState();
    app.setActiveModelId(null);
    app.setDownloadedModels([]);
    app.setOnboardingComplete(false);
  });

  it('opens the Pro screen with its two valid actions and no device-licence shortcut', async () => {
    const ui = render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );

    fireEvent.press(await ui.findByLabelText('Open Off Grid AI Pro'));

    await waitFor(() => expect(ui.getByText('Off Grid AI Pro')).toBeTruthy());
    expect(ui.getAllByText('Get Pro').length).toBeGreaterThan(0);
    expect(ui.getByText('I have a license key')).toBeTruthy();
    expect(ui.queryByText('Use Pro from another device')).toBeNull();

    ui.unmount();
  });
});
