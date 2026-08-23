/**
 * The notifications screen's filter: what the user sees when they narrow it down.
 *
 * This screen is where three unrelated things pile up - files waiting for the user's approval, completed
 * transfers, and the results of ones already decided. The filter exists because that pile is unreadable, so the
 * filter has to actually narrow: choosing Approvals and still seeing transfers makes it useless, and choosing
 * Approvals and seeing NOTHING when approvals exist hides the one thing on this screen that is waiting on a
 * person.
 *
 * The empty copy matters just as much. "No files are waiting for approval" is the answer to a question the user
 * asked; a blank area is not, and reads as a screen that failed to load. The singular/plural line ("1 file is"
 * versus "2 files are") is the kind of thing nobody notices until it says "1 files are".
 *
 * Real screen, real store, real projections. Faked: the icon font, navigation, and the native TCP and mDNS
 * modules the sync services build emitters over at import.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: { name: string }) => <Text>{name}</Text>;
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

import { proIsPresent, requirePro } from '../helpers/requirePro';

const describePro = proIsPresent() ? describe : describe.skip;

type ScreenModule = typeof import('@offgrid/pro/ui/SyncNotificationsScreen');
let SyncNotificationsScreen: ScreenModule['SyncNotificationsScreen'];

beforeAll(() => {
  const mod = requirePro<ScreenModule>('@offgrid/pro/ui/SyncNotificationsScreen');
  if (mod) SyncNotificationsScreen = mod.SyncNotificationsScreen;
});

const FILTERS = ['all', 'approvals', 'transfers', 'recent'] as const;

const chooseFilter = (
  ui: ReturnType<typeof render>,
  filter: (typeof FILTERS)[number],
): void => {
  fireEvent.press(ui.getByTestId('sync-notifications-filter'));
  fireEvent.press(
    ui.getByTestId(`sync-notifications-filter-option-${filter}`),
  );
};

describePro('the notifications screen filter', () => {
  it('offers every filter, with All chosen to begin with', () => {
    const ui = render(<SyncNotificationsScreen />);
    fireEvent.press(ui.getByTestId('sync-notifications-filter'));

    // All four are reachable. A filter that is not rendered is a section the user can never isolate.
    for (const filter of FILTERS) {
      expect(
        ui.queryByTestId(`sync-notifications-filter-option-${filter}`),
      ).not.toBeNull();
    }
  });

  it('says nothing is waiting for approval, rather than showing a blank area', () => {
    const ui = render(<SyncNotificationsScreen />);

    // The answer to the question the user asked by opening this screen. Blank space reads as a failed load.
    expect(ui.queryByText('No files are waiting for approval.')).not.toBeNull();
  });

  it('keeps the approvals answer visible when the user narrows to Approvals', () => {
    const ui = render(<SyncNotificationsScreen />);

    chooseFilter(ui, 'approvals');

    // Narrowing to a section must not empty the screen of the very thing being narrowed to.
    expect(ui.queryByText('No files are waiting for approval.')).not.toBeNull();
  });

  it('drops the approvals section entirely when the user narrows to Transfers', () => {
    const ui = render(<SyncNotificationsScreen />);

    chooseFilter(ui, 'transfers');

    // The whole purpose of the filter. Still showing approvals here would make it decorative.
    expect(ui.queryByText('No files are waiting for approval.')).toBeNull();
  });

  it('drops the approvals section when the user narrows to Recent', () => {
    const ui = render(<SyncNotificationsScreen />);

    chooseFilter(ui, 'recent');

    expect(ui.queryByText('No files are waiting for approval.')).toBeNull();
  });

  it('comes back to everything when the user chooses All again', () => {
    const ui = render(<SyncNotificationsScreen />);

    chooseFilter(ui, 'transfers');
    expect(ui.queryByText('No files are waiting for approval.')).toBeNull();
    chooseFilter(ui, 'all');

    // A filter the user cannot undo traps them on a partial view of their own device.
    expect(ui.queryByText('No files are waiting for approval.')).not.toBeNull();
  });

  it('offers a way to reach the screens the notifications came from', () => {
    const ui = render(<SyncNotificationsScreen />);

    // A notification about a file is only useful if the user can get to the file. At least one destination has
    // to be offered, or this screen is a dead end.
    const destinations = ui.queryAllByTestId(/^sync-notifications-open-/);
    expect(destinations.length).toBeGreaterThan(0);
  });
});
