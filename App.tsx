/**
 * Off Grid - On-Device AI Chat Application
 * Private AI assistant that runs entirely on your device
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback } from 'react';
import { StatusBar, ActivityIndicator, View, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './src/navigation';
import { useTheme } from './src/theme';
import { hardwareService, modelManager, authService } from './src/services';
import { useAppStore, useAuthStore } from './src/stores';
import { LockScreen } from './src/screens';
import { useAppState } from './src/hooks/useAppState';
import { LogBox } from 'react-native';

LogBox.ignoreAllLogs(); // Suppress all logs

function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const setDeviceInfo = useAppStore((s) => s.setDeviceInfo);
  const setModelRecommendation = useAppStore((s) => s.setModelRecommendation);
  const setDownloadedModels = useAppStore((s) => s.setDownloadedModels);
  const setDownloadedImageModels = useAppStore((s) => s.setDownloadedImageModels);

  const { colors, isDark } = useTheme();

  const {
    isEnabled: authEnabled,
    isLocked,
    setLocked,
    setLastBackgroundTime,
  } = useAuthStore();

  // Handle app state changes for auto-lock
  useAppState({
    onBackground: useCallback(() => {
      if (authEnabled) {
        setLastBackgroundTime(Date.now());
        setLocked(true);
      }
    }, [authEnabled, setLastBackgroundTime, setLocked]),
    onForeground: useCallback(() => {
      // Lock is already set when going to background
      // Nothing additional needed here
    }, []),
  });

  useEffect(() => {
    initializeApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializeApp = async () => {
    try {
      // Phase 1: Quick initialization - get app ready to show UI
      // Initialize hardware detection
      const deviceInfo = await hardwareService.getDeviceInfo();
      setDeviceInfo(deviceInfo);

      const recommendation = hardwareService.getModelRecommendation();
      setModelRecommendation(recommendation);

      // Initialize model manager and load downloaded models list
      await modelManager.initialize();

      // Clean up any mmproj files that were incorrectly added as standalone models
      await modelManager.cleanupMMProjEntries();

      // Wire up background download metadata persistence
      const { setBackgroundDownload, activeBackgroundDownloads, addDownloadedModel } = useAppStore.getState();
      modelManager.setBackgroundDownloadMetadataCallback((downloadId, info) => {
        setBackgroundDownload(downloadId, info);
      });

      // Recover any background downloads that completed while app was dead
      try {
        const recoveredModels = await modelManager.syncBackgroundDownloads(
          activeBackgroundDownloads,
          (downloadId) => setBackgroundDownload(downloadId, null)
        );
        for (const model of recoveredModels) {
          addDownloadedModel(model);
          console.log('[App] Recovered background download:', model.name);
        }
      } catch (err) {
        console.error('[App] Failed to sync background downloads:', err);
      }

      // Scan for any models that may have been downloaded externally or
      // when app was killed before JS callback fired
      const { textModels, imageModels } = await modelManager.refreshModelLists();
      setDownloadedModels(textModels);
      setDownloadedImageModels(imageModels);

      // Check if passphrase is set and lock app if needed
      const hasPassphrase = await authService.hasPassphrase();
      if (hasPassphrase && authEnabled) {
        setLocked(true);
      }

      // Show the UI immediately
      setIsInitializing(false);

      // Models are loaded on-demand when the user opens a chat,
      // not eagerly on startup, to avoid freezing the UI.
    } catch (error) {
      console.error('Error initializing app:', error);
      setIsInitializing(false);
    }
  };

  const handleUnlock = useCallback(() => {
    setLocked(false);
  }, [setLocked]);

  if (isInitializing) {
    return (
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <View style={[styles.loadingContainer, { backgroundColor: colors.background }]} testID="app-loading">
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Show lock screen if auth is enabled and app is locked
  if (authEnabled && isLocked) {
    return (
      <GestureHandlerRootView style={styles.flex} testID="app-locked">
        <SafeAreaProvider>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
          <LockScreen onUnlock={handleUnlock} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
        <NavigationContainer
          theme={{
            dark: isDark,
            colors: {
              primary: colors.primary,
              background: colors.background,
              card: colors.surface,
              text: colors.text,
              border: colors.border,
              notification: colors.primary,
            },
            fonts: {
              regular: {
                fontFamily: 'System',
                fontWeight: '400',
              },
              medium: {
                fontFamily: 'System',
                fontWeight: '500',
              },
              bold: {
                fontFamily: 'System',
                fontWeight: '700',
              },
              heavy: {
                fontFamily: 'System',
                fontWeight: '900',
              },
            },
          }}
        >
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default App;
