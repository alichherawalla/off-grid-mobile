/**
 * Off Grid - On-Device AI Chat Application
 * Private AI assistant that runs entirely on your device
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { LogBox } from 'react-native';
import { useProExpiryRedirect } from './src/navigation/useProExpiryRedirect';
import { useTheme } from './src/theme';
import {
  hardwareService,
  modelLibrary,
  authService,
  remoteServerManager,
} from './src/services';
import logger from './src/utils/logger';
import { useAppStore, useAuthStore, useRemoteServerStore } from './src/stores';
import { transcriptionModelIntents } from './src/services/modelServices/transcriptionRuntimePort';
import { useDebugLogsStore } from './src/stores/debugLogsStore';
import { useWhisperStore } from './src/stores/whisperStore';
import {
  initDebugLogFile,
  appendDebugLine,
  stopDebugLogFile,
} from './src/utils/debugLogFile';
import { startStartupMemoryProbe } from './src/services/startupMemoryProbe';
import { loadProFeatures } from './src/bootstrap/loadProFeatures';
import { hydrateDownloadStore } from './src/services/downloadHydration';
import { initActiveDownloadPersistence } from './src/services/activeDownloadPersistence';
import { restoreQueuedDownloads } from './src/services/restoreQueuedDownloads';
import { createLoadPolicySync } from './src/services/loadPolicySync';
import {
  startMobileApplication,
  stopMobileApplication,
} from './src/services/composition/application';
import {
  refreshMobileModelServices,
  startMobileModelServices,
  stopMobileModelServices,
} from './src/services/modelServices';
import {
  startNetworkReconnectWatcher,
  stopNetworkReconnectWatcher,
} from './src/services/networkReconnect';
import { registerCoreDownloadProviders } from './src/services/modelServices/downloadBootstrap';
import { reconcileImageDownloadsAtBootstrap } from './src/services/modelServices/imageDownloadRecoveryApplication';
import { useDownloadListeners } from './src/hooks/useDownloads';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSlot, SLOTS } from './src/bootstrap/slotRegistry';
import { useAppState } from './src/hooks/useAppState';
import { useDownloadStore } from './src/stores/downloadStore';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import {
  InitializingSurface,
  LockedSurface,
  MainSurface,
} from './src/bootstrap/AppSurfaces';

LogBox.ignoreAllLogs(); // Suppress all logs

let stopStartupProbe: (() => void) | null = null;
// Dev-only: mirror logger output into the in-app Debug Logs viewer. The whole block
// is behind __DEV__, so release builds keep main's no-op logger (zero logging cost).
if (__DEV__) {
  const fmt = (a: unknown): string => {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };
  const base = { log: logger.log, warn: logger.warn, error: logger.error };
  const tap =
    (level: 'log' | 'warn' | 'error') =>
    (...args: unknown[]) => {
      base[level](...args);
      const message = args.map(fmt).join(' ');
      try {
        useDebugLogsStore
          .getState()
          .addLog({ timestamp: Date.now(), level, message });
      } catch {
        /* never break logging */
      }
      // Persist to the on-device file sink so traces can be pulled over the cable
      // (RN 0.83 console logs don't reach Metro stdout or syslog). See debugLogFile.ts.
      try {
        appendDebugLine(level, message);
      } catch {
        /* never break logging */
      }
    };
  logger.log = tap('log');
  logger.warn = tap('warn');
  logger.error = tap('error');
  initDebugLogFile();
  // Immediately after the sink exists, so the first sample lands before anything heavy runs. The app
  // was being killed by iOS at launch with the log going silent half a second in; this says where it
  // stops and what memory was doing when it did.
  stopStartupProbe = startStartupMemoryProbe();
}

const ensureRemoteServerStoreHydrated = async () => {
  const persistApi = useRemoteServerStore.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) {
    await persistApi.rehydrate();
  }
};

const ensureWhisperStoreHydrated = async () => {
  const persistApi = useWhisperStore.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) {
    await persistApi.rehydrate();
  }
};

const reconcileTranscriptionSelection = async () => {
  await ensureWhisperStoreHydrated();
  try {
    await transcriptionModelIntents.reconcileDisk();
  } catch (error) {
    logger.error('[App] Whisper disk reconciliation failed:', error);
  }
};

function stopMobileRuntime(loadPolicySync: ReturnType<typeof createLoadPolicySync>): void {
  stopNetworkReconnectWatcher();
  stopMobileModelServices();
  stopMobileApplication();
  loadPolicySync.dispose();
}

function App() {
  useEffect(
    () => () => {
      stopStartupProbe?.();
      stopStartupProbe = null;
      stopDebugLogFile();
    },
    [],
  );
  useDownloadListeners();
  // Reactive: when Pro is activated at runtime (license key → loadProFeatures),
  // the appRoot slot (TTS engine bridge) registers and this re-renders to mount
  // it live — no restart needed.
  const AppRoot = useSlot(SLOTS.appRoot);
  const applyPendingProRedirect = useProExpiryRedirect();
  const [isInitializing, setIsInitializing] = useState(true);
  const startupGeneration = useRef(0);
  const setDeviceInfo = useAppStore(s => s.setDeviceInfo);
  const setModelRecommendation = useAppStore(s => s.setModelRecommendation);
  const setDownloadedModels = useAppStore(s => s.setDownloadedModels);
  const setDownloadedImageModels = useAppStore(s => s.setDownloadedImageModels);
  const { colors, isDark } = useTheme();

  const {
    isEnabled: authEnabled,
    isLocked,
    setLocked,
    setLastBackgroundTime,
  } = useAuthStore();

  const reattachTextDownloadRecovery = useCallback(async () => {
    const restoredIds = await modelLibrary.restoreInProgressDownloads();
    modelLibrary.startBackgroundDownloadPolling();
    restoredIds.forEach(downloadId => {
      modelLibrary.watchDownload(
        downloadId,
        async () => {
          const models = await modelLibrary.getDownloadedModels();
          setDownloadedModels(models);
          useDownloadStore
            .getState()
            .remove(
              useDownloadStore.getState().downloadIdIndex[downloadId] ?? '',
            );
        },
        (error: Error) => {
          logger.error('[App] Restored text download failed:', error);
          useDownloadStore
            .getState()
            .setStatus(downloadId, 'failed', { message: error.message });
        },
      );
    });
  }, [setDownloadedModels]);

  // Handle app state changes for auto-lock
  useAppState({
    onBackground: useCallback(() => {
      if (authEnabled) {
        setLastBackgroundTime(Date.now());
        setLocked(true);
      }
    }, [authEnabled, setLastBackgroundTime, setLocked]),
    onForeground: useCallback(() => {
      // Rebuild the unified store before reattaching JS listeners so restored
      // progress events map onto current download entries instead of racing hydration.
      // NOTE: restoreQueuedDownloads() is intentionally NOT called here — on a foreground
      // resume the process was never killed, so backgroundDownloadService.startQueue (the
      // in-memory FIFO) is still the live source of truth for queued items. Replaying the
      // persisted queue here would DOUBLE-issue starts that are still waiting in memory.
      // Restore is a cold-start-only concern (the queue owner is gone only after a kill).
      hydrateDownloadStore()
        .catch(error => {
          logger.error(
            '[App] Failed to hydrate download store on foreground:',
            error,
          );
        })
        .finally(() => {
          reattachTextDownloadRecovery().catch(error => {
            logger.error(
              '[App] Failed to restore text downloads on foreground:',
              error,
            );
          });
        });
    }, [reattachTextDownloadRecovery]),
  });

  const ensureAppStoreHydrated = useCallback(async () => {
    const persistApi = useAppStore.persist;
    if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
    if (!persistApi.hasHydrated()) {
      await persistApi.rehydrate();
    }
  }, []);

  /**
   * Download-state recovery — the chain that reads/repairs the native download DB. Ordered
   * internally exactly as before (hydrate → reattach → register providers → restore queued →
   * image reconcile → model-list refresh), but NOT awaited by the boot gate: under heavy
   * download I/O the Room read alone stalled ~10s (write-lock contention) and blanked boot.
   * Screens read reactive stores, so recovered rows/models appear when this lands.
   */
  const recoverDownloadState = useCallback(() => {
    (async () => {
      // Persist the in-flight download set for the rest of the session (idempotent) BEFORE the first
      // hydrate, so a download started this run is durably recorded and can be stranded as a
      // failed/retriable card — not vanish — if the app is hard-killed mid-transfer (iOS URLSession).
      initActiveDownloadPersistence();
      await hydrateDownloadStore().catch(error => {
        logger.error(
          '[App] Failed to hydrate download store during startup:',
          error,
        );
      });
      await reattachTextDownloadRecovery();

      // Register the core download providers so the unified service is reactive for
      // any screen (registration only subscribes — no writes). NOTE: do NOT call
      // modelDownloadService.reconcile() here yet — the existing reattachTextDownload
      // Recovery (above) + the image-resume path are still the owners of post-launch
      // recovery, and running provider reconcile() alongside them = two writers to
      // downloadStore (a download one restores, the other strands). reconcile()
      // becomes the SINGLE owner only once the Download Manager consumes the service
      // and the old recovery paths are folded into the providers.
      registerCoreDownloadProviders();

      // Re-surface QUEUED downloads that never started before an app kill. A queued item (waiting for
      // one of the 3 concurrency slots) has no native row, so hydrateDownloadStore can't recover it —
      // it lives only in the durably-persisted queue. restore replays it through the owning provider's
      // real start (re-creating the pending row + watch); items auto-start as slots free. Runs AFTER
      // provider registration (restore dispatches to the providers) and hydrate (so it dedupes against
      // any native row that DID start). Fire-and-forget: a failure must not abort launch.
      await restoreQueuedDownloads().catch(error => {
        logger.error(
          '[App] Failed to restore queued downloads during startup:',
          error,
        );
      });

      await reconcileImageDownloadsAtBootstrap().catch(error => {
        logger.error(
          '[App] Failed to resume image downloads during startup:',
          error,
        );
      });

      // Reconcile image model directories that finished extracting on disk but whose AsyncStorage
      // registration was lost to an app kill. Reads the (just-hydrated) download store, so it lives
      // in this chain; the closing refreshModelLists republishes any recovered models to the UI.
      const activeImageModelIds = new Set(
        Object.values(useDownloadStore.getState().downloads)
          .filter(e => e.modelType === 'image')
          .map(e => e.modelId.replace('image:', '')),
      );
      await modelLibrary
        .reconcileFinishedImageDownloads(activeImageModelIds)
        .catch(error => {
          logger.error('[App] Image model reconciliation failed:', error);
        });
      logger.log('[BOOT] refresh model lists');
      const { textModels, imageModels } =
        await modelLibrary.refreshModelLists();
      setDownloadedModels(textModels);
      setDownloadedImageModels(imageModels);
    })().catch(error => {
      logger.error('[App] Download-state recovery failed:', error);
    });
  }, [
    reattachTextDownloadRecovery,
    setDownloadedModels,
    setDownloadedImageModels,
  ]);

  const initializeApp = useCallback(
    async (
      generation: number,
      loadPolicySync: ReturnType<typeof createLoadPolicySync>,
    ) => {
      try {
        // Ensure persisted download metadata is loaded before restore logic reads it.
        logger.log('[BOOT] app store hydrate');
        await ensureAppStoreHydrated();

        // Project the persisted "aggressive model loading" setting onto the residency
        // manager (single owner of the runtime load policy) now that settings are
        // hydrated, and keep it in sync for the app's lifetime.
        loadPolicySync.start();

        // Download-state recovery runs OFF the boot gate (fire-and-forget, order preserved
        // inside recoverDownloadState below): with many WorkManager downloads mid-flight the
        // native Room DB read (getActiveDownloads) sat ~9.5s behind write-lock contention
        // (device 2026-07-13, 9 active downloads) and the WHOLE app was hostage to it. The
        // download rows/badges are reactive projections — they fill in when recovery lands.
        recoverDownloadState();

        // Phase 1: Quick initialization - get app ready to show UI
        // Initialize hardware detection
        logger.log('[BOOT] device info');
        const deviceInfo = await hardwareService.getDeviceInfo();
        setDeviceInfo(deviceInfo);

        const recommendation = hardwareService.getModelRecommendation();
        setModelRecommendation(recommendation);

        // Initialize model manager and load downloaded models list
        logger.log('[BOOT] model library initialize');
        await modelLibrary.initialize();

        // Clean up any mmproj files that were incorrectly added as standalone models
        logger.log('[BOOT] cleanup mmproj entries');
        await modelLibrary.cleanupMMProjEntries();

        // Scan for any models that may have been downloaded externally or
        // while the app was killed. hydrateDownloadStore (called on cold start
        // and foreground resume) repopulates in-flight downloads directly
        // from the native Room DB, replacing the old metadata-callback +
        // syncBackgroundDownloads recovery path.
        const { textModels, imageModels } =
          await modelLibrary.refreshModelLists();
        setDownloadedModels(textModels);
        setDownloadedImageModels(imageModels);

        // Ensure remote server store is hydrated before initializing providers,
        // so getServers() / activeServerId reads see persisted data.
        logger.log('[BOOT] remote server hydrate');
        await ensureRemoteServerStoreHydrated();

        // The Shared workflow must see the persisted transcription selection before it compares
        // that selection with disk inventory. Running this after the UI mounted allowed AsyncStorage
        // to restore a missing model after reconciliation had already cleared it.
        logger.log('[BOOT] transcription selection reconcile');
        await reconcileTranscriptionSelection();

        try {
          // Pro supplies optional domain ports before core creates the single application root.
          logger.log('[BOOT] load pro features');
          await loadProFeatures();
        } catch (proError) {
          logger.error(
            '[App] Pro feature load failed, continuing without Pro:',
            proError,
          );
        }

        startMobileModelServices();
        await refreshMobileModelServices();

        // Initialize remote server providers in the background — don't block
        // the home screen while fetching models from potentially unreachable servers.
        remoteServerManager
          .initializeProviders()
          .catch(err => {
            logger.error(
              '[App] Failed to initialize remote server providers:',
              err,
            );
          })
          .finally(() => {
            refreshMobileModelServices().catch(err =>
              logger.error('[App] Model refresh failed:', err),
            );
            if (generation !== startupGeneration.current) return;
            // Recovery and provider initialization both update the registry and remote-server store.
            // Start recovery only after initialization releases those owners. A failed initialization
            // must still start the watcher so a later network recovery can repair the connection.
            startNetworkReconnectWatcher();
          });

        // Check if passphrase is set and lock app if needed
        logger.log('[BOOT] auth passphrase check');
        const hasPassphrase = await authService.hasPassphrase();
        if (hasPassphrase && authEnabled) {
          setLocked(true);
        }

        // Start the single application root, including RAG and any registered Pro domains.
        try {
          await startMobileApplication();
        } catch (applicationError) {
          logger.error(
            'Failed to initialize the application on startup',
            applicationError,
          );
        }

        // Show the UI immediately
        logger.log('[BOOT] startup complete');
        setIsInitializing(false);

        // Models are intentionally NOT warmed at boot. A native model load is heavy
        // and contends with startup, leaving the whole app sluggish in that window.
        // Text, TTS, and STT load on demand. This keeps app launch responsive.
      } catch (error) {
        logger.error('[App] Error initializing app:', error);
        setIsInitializing(false);
      }
    },
    [
      authEnabled,
      ensureAppStoreHydrated,
      recoverDownloadState,
      setDeviceInfo,
      setDownloadedImageModels,
      setDownloadedModels,
      setLocked,
      setModelRecommendation,
    ],
  );

  useEffect(() => {
    const loadPolicySync = createLoadPolicySync();
    const generation = ++startupGeneration.current;
    initializeApp(generation, loadPolicySync);
    return () => {
      startupGeneration.current += 1;
      stopMobileRuntime(loadPolicySync);
    };
  }, [initializeApp]);

  const handleUnlock = useCallback(() => setLocked(false), [setLocked]);

  if (isInitializing) {
    return <InitializingSurface colors={colors} isDark={isDark} />;
  }

  if (authEnabled && isLocked) {
    return (
      <LockedSurface
        colors={colors}
        isDark={isDark}
        onUnlock={handleUnlock}
      />
    );
  }

  return (
    <MainSurface
      AppRoot={AppRoot}
      colors={colors}
      isDark={isDark}
      onNavigationReady={applyPendingProRedirect}
    />
  );
}

// KeyboardProvider drives react-native-keyboard-controller's edge-to-edge-aware
// keyboard avoidance (used by ChatScreen). It must sit above every screen, so
// wrap the whole app once here rather than per return-branch in App().
function AppWithProviders() {
  return (
    <ErrorBoundary>
      <KeyboardProvider>
        <App />
      </KeyboardProvider>
    </ErrorBoundary>
  );
}

export default AppWithProviders;
