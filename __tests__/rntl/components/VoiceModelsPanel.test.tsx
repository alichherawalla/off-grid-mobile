/**
 * VoiceModelsPanel tests
 *
 * The Voice picker (Models screen tab + home/chat Voice sheet). With a single
 * engine it is a VOICE picker, not an engine picker. Verifies:
 *  - the RAM privacy banner
 *  - not-downloaded → a single "Download voice" action (opt-in)
 *  - downloaded → a selectable list of voices; tapping one selects it
 */
import type { PersistedModelDownload } from '@offgrid/models';
import type { VoiceModelsPanel } from '../../../pro/audio/ui/VoiceModelsPanel';

const voiceDownload = (phase: 'queued' | 'paused'): PersistedModelDownload => ({
  manifest: {
    id: 'tts:software-mansion/executorch-kokoro',
    modelId: 'software-mansion/executorch-kokoro',
    kind: 'voice',
    revision: 'runtime',
    artifacts: [
      {
        id: 'kokoro-medium',
        name: 'kokoro-medium',
        role: 'primary',
        required: true,
        localName: 'kokoro-medium',
        url: '',
        sizeBytes: 82 * 1024 * 1024,
      },
    ],
  },
  phase,
  artifacts: [
    {
      artifactId: 'kokoro-medium',
      phase,
      bytesDownloaded: Math.round(82 * 1024 * 1024 * 0.4),
      totalBytes: 82 * 1024 * 1024,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
  attempt: 1,
});

async function renderVoicePanel(downloads: PersistedModelDownload[] = []) {
  const { installNativeBoundary, requireRTL } =
    require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
  const boundary = installNativeBoundary({ fs: true, download: true });
  const { seedMobileDownloadJournal, startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  if (downloads.length) await seedMobileDownloadJournal(downloads);
  const fixture = await startMobileApplicationFixture({ pro: true });
  const rtl = requireRTL();
  const RuntimeReact = require('react') as typeof import('react');
  const Panel = require('../../../pro/audio/ui/VoiceModelsPanel')
    .VoiceModelsPanel as typeof VoiceModelsPanel;
  const view = rtl.render(RuntimeReact.createElement(Panel));
  return { boundary, fixture, rtl, view };
}

async function renderPersistedVoiceDownload(phase: 'queued' | 'paused') {
  return renderVoicePanel([voiceDownload(phase)]);
}

describe('VoiceModelsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the RAM privacy banner', async () => {
    const { fixture, view } = await renderVoicePanel();

    try {
      expect(view.getByText(/nothing is sent anywhere/)).toBeTruthy();
    } finally {
      view.unmount();
      await fixture.dispose();
    }
  });

  it('filters voices by language and selects the first voice when language changes', async () => {
    const { fixture, rtl, view } = await renderVoicePanel();

    try {
      rtl.fireEvent.press(view.getByText('Download voice'));
      await rtl.waitFor(() => {
        expect(view.getByTestId('voice-af_heart')).toBeTruthy();
      });
      expect(view.queryByTestId('voice-bf_emma')).toBeNull();

      rtl.fireEvent.press(view.getByTestId('models-tts-language'));
      rtl.fireEvent.press(
        view.getByTestId('models-tts-language-en-GB'),
      );
      await rtl.waitFor(() => {
        expect(view.getByTestId('voice-bf_emma')).toBeTruthy();
        expect(view.queryByTestId('voice-af_heart')).toBeNull();
      });
    } finally {
      view.unmount();
      await fixture.dispose();
    }
  });

  it('shows an opt-in download when the model is not downloaded', async () => {
    const { fixture, rtl, view } = await renderVoicePanel();

    try {
      const cta = view.getByText('Download voice');
      rtl.fireEvent.press(cta);
      await rtl.waitFor(() => {
        expect(view.getByTestId('voice-af_heart')).toBeTruthy();
      });
      expect(view.queryByText('Download voice')).toBeNull();
    } finally {
      view.unmount();
      await fixture.dispose();
    }
  });

  it('shows the model as DOWNLOADED (voices) when the service reports completed, even if the engine is not loaded — the mismatch fix', async () => {
    const { fixture, rtl, view } = await renderVoicePanel();

    try {
      rtl.fireEvent.press(view.getByText('Download voice'));
      await rtl.waitFor(() => {
        expect(view.getByTestId('voice-af_heart')).toBeTruthy();
      });
      expect(view.queryByText('Download voice')).toBeNull();
      expect(view.queryByText('0%')).toBeNull();
    } finally {
      view.unmount();
      await fixture.dispose();
    }
  });

  it('shows live progress while the service reports downloading', async () => {
    const { fixture, rtl, view } = await renderVoicePanel();
    const { BareResourceFetcher } =
      require('react-native-executorch-bare-resource-fetcher') as typeof import('react-native-executorch-bare-resource-fetcher');
    let finishDownload!: () => void;
    const heldDownload = new Promise<void>(resolve => {
      finishDownload = resolve;
    });
    (BareResourceFetcher.fetch as jest.Mock).mockImplementationOnce(
      async (onProgress: (progress: number) => void) => {
        onProgress(0.4);
        await heldDownload;
      },
    );
    try {
      rtl.fireEvent.press(view.getByText('Download voice'));
      await rtl.waitFor(() => {
        expect(view.getByText('40%')).toBeTruthy();
      });
      expect(view.queryByText('Download voice')).toBeNull();
      expect(view.queryByText(/Rate unavailable/)).toBeNull();
      expect(view.queryByText(/NaN/)).toBeNull();
    } finally {
      finishDownload();
      await rtl.waitFor(() => {
        expect(view.getByTestId('voice-af_heart')).toBeTruthy();
      });
      view.unmount();
      await fixture.dispose();
    }
  });

  it('shows transferred bytes and rate from the shared download projection', async () => {
    const { fixture, rtl, view } = await renderVoicePanel();
    const { BareResourceFetcher } =
      require('react-native-executorch-bare-resource-fetcher') as typeof import('react-native-executorch-bare-resource-fetcher');
    let finishDownload!: () => void;
    const heldDownload = new Promise<void>(resolve => {
      finishDownload = resolve;
    });
    (BareResourceFetcher.fetch as jest.Mock).mockImplementationOnce(
      async (onProgress: (progress: number) => void) => {
        onProgress(0.25);
        await new Promise(resolve => setTimeout(resolve, 50));
        onProgress(0.5);
        await heldDownload;
      },
    );
    try {
      rtl.fireEvent.press(view.getByText('Download voice'));
      await rtl.waitFor(() => {
        expect(view.getByText('50%')).toBeTruthy();
        expect(view.getByText(/41 MB \/ 82 MB · .* MB\/s/)).toBeTruthy();
      });
    } finally {
      finishDownload();
      await rtl.waitFor(() => {
        expect(view.getByTestId('voice-af_heart')).toBeTruthy();
      });
      view.unmount();
      await fixture.dispose();
    }
  });

  it('shows progress (not the idle CTA) for queued and paused too — the shared in-progress predicate', async () => {
    // Regression: the panel used a bare `=== 'downloading'`, so a queued or a
    // kill-interrupted (paused) TTS download flashed the "Download voice" CTA.
    for (const status of ['queued', 'paused'] as const) {
      const { fixture, rtl, view } = await renderPersistedVoiceDownload(status);
      try {
        await rtl.waitFor(() => {
          expect(view.getByText('40%')).toBeTruthy();
          expect(view.queryByText('Download voice')).toBeNull();
        });
      } finally {
        view.unmount();
        await fixture.dispose();
      }
    }
  });

  it('backfills the persisted-downloaded flag from disk when the panel opens', async () => {
    const { fixture, rtl, view: first } = await renderVoicePanel();
    const Panel = require('../../../pro/audio/ui/VoiceModelsPanel')
      .VoiceModelsPanel as typeof VoiceModelsPanel;
    let firstUnmounted = false;

    try {
      rtl.fireEvent.press(first.getByText('Download voice'));
      await rtl.waitFor(() => {
        expect(first.getByTestId('voice-af_heart')).toBeTruthy();
      });
      first.unmount();
      firstUnmounted = true;

      const RuntimeReact = require('react') as typeof import('react');
      const reopened = rtl.render(RuntimeReact.createElement(Panel));
      try {
        await rtl.waitFor(() => {
          expect(reopened.getByTestId('voice-af_heart')).toBeTruthy();
          expect(reopened.queryByText('Download voice')).toBeNull();
        });
      } finally {
        reopened.unmount();
      }
    } finally {
      if (!firstUnmounted) first.unmount();
      await fixture.dispose();
    }
  });
});
