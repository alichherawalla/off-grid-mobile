/**
 * Repair progress shows on the FEED card and is store-owned (rendered integration).
 *
 * Repair used to hold its "repairing" flag in the detail screen's local state, so leaving the screen
 * dropped it (looked broken) and the feed never showed it - even though the work ran to completion.
 * It now lives on the recording as repairStatus ('repairing' -> 'pruning'), owned by recordingRepair,
 * so BOTH the feed card and the detail read it and it survives navigation. This mounts the real feed
 * and asserts the card reflects each phase. No mocking our own code.
 */
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { installPro } from '../harness/proHarness';

const CASES: { name: string; status: 'repairing' | 'pruning'; label: RegExp }[] = [
  { name: "repairing → 'Repairing' on the card", status: 'repairing', label: /^Repairing/ },
  { name: "pruning → 'Cleaning up' on the card", status: 'pruning', label: /^Cleaning up/ },
];

describe('repair progress shows on the feed card (rendered)', () => {
  it.each(CASES)('$name', async ({ status, label }) => {
    const boundary = installNativeBoundary({ fs: true });
    const React = require('react');
    const { StyleSheet } = require('react-native');
    const { render, waitFor, act, within } = requireRTL();
    await installPro();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { getRegisteredScreens } = require('../../src/navigation/screenRegistry');
    const { useRecordingsStore, useAlwaysOnSettingsStore } = require('@offgrid/pro/locket/stores');
    const { useWhisperStore } = require('../../src/stores');

    // A transcription model must exist or the feed renders the first-run setup card instead of
    // the timeline. And autoAnalyse is ON by default now: with an un-analysed clip on today it
    // fires on mount, fails with 'no-model' (no LLM here), and the feed routes itself to setup -
    // burying the timeline behind an aria-hidden screen. Neither is what this test is about.
    useWhisperStore.setState({ downloadedModelId: 'base.en' });
    useAlwaysOnSettingsStore.setState({ autoAnalyse: false });
    useRecordingsStore.setState({ recordings: [], jobs: [] });
    const NOW = Date.now();
    // Clearly in the past (today) so it's visible without a prunedAt - a mid-repair clip has none.
    const startedAt = NOW - 2 * 60 * 60 * 1000;
    boundary.fs!.seedFile('/docs/rec.wav', 5_000_000);
    useRecordingsStore.getState().addFinalized({
      path: '/docs/rec.wav', startedAt, endedAt: startedAt + 30 * 60 * 1000,
      durationMs: 30 * 60 * 1000, sizeBytes: 5_000_000,
    });
    const id: string = useRecordingsStore.getState().recordings[0].id;

    const Stack = createNativeStackNavigator();
    const screens = getRegisteredScreens();
    const App = () => React.createElement(NavigationContainer, null,
      React.createElement(Stack.Navigator, { initialRouteName: 'LocketFeed', screenOptions: { headerShown: false } },
        ...screens.map((sc: { name: string; component: React.ComponentType }) =>
          React.createElement(Stack.Screen, { key: sc.name, name: sc.name, component: sc.component }))));
    const ui = render(React.createElement(App));
    await act(async () => { await Promise.resolve(); });

    await waitFor(() => ui.getByTestId(`today-clip-${id}`));

    // Repair starts NOW (clip already displayed) - exactly what recordingRepair emits mid-run.
    // The card must react to the store-owned status without any navigation.
    await act(async () => {
      useRecordingsStore.getState().updateRecording(id, { repairStatus: status });
      await Promise.resolve();
    });

    const card = ui.getByTestId(`today-clip-${id}`);
    // It's treated as processing (the green left-border, borderLeftWidth 3, from isRecordingProcessing).
    expect(StyleSheet.flatten(card.props.style).borderLeftWidth).toBe(3);
    // The phase label is on the card.
    expect(within(card).getByText(label)).toBeTruthy();
  });
});
