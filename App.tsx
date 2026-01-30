/**
 * Local LLM - On-Device AI Chat Application
 * Private AI assistant that runs entirely on your device
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback } from 'react';
import { StatusBar, ActivityIndicator, View, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './src/navigation';
import { COLORS } from './src/constants';
import { hardwareService, modelManager, authService, llmService, onnxImageGeneratorService } from './src/services';
import { useAppStore, useAuthStore, useWhisperStore } from './src/stores';
import { LockScreen } from './src/screens';
import { useAppState } from './src/hooks/useAppState';

function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const setDeviceInfo = useAppStore((s) => s.setDeviceInfo);
  const setModelRecommendation = useAppStore((s) => s.setModelRecommendation);
  const setDownloadedModels = useAppStore((s) => s.setDownloadedModels);
  const setDownloadedImageModels = useAppStore((s) => s.setDownloadedImageModels);

  const {
    isEnabled: authEnabled,
    isLocked,
    setLocked,
    setLastBackgroundTime,
  } = useAuthStore();

  const {
    downloadedModelId: whisperModelId,
    loadModel: loadWhisperModel,
  } = useWhisperStore();

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
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize hardware detection
      const deviceInfo = await hardwareService.getDeviceInfo();
      setDeviceInfo(deviceInfo);

      const recommendation = hardwareService.getModelRecommendation();
      setModelRecommendation(recommendation);

      // Initialize model manager and load downloaded models
      await modelManager.initialize();
      const downloadedModels = await modelManager.getDownloadedModels();
      setDownloadedModels(downloadedModels);

      // Check if passphrase is set and lock app if needed
      const hasPassphrase = await authService.hasPassphrase();
      if (hasPassphrase && authEnabled) {
        setLocked(true);
      }

      // Load Whisper model if downloaded (for voice transcription)
      if (whisperModelId) {
        console.log('[App] Loading Whisper model:', whisperModelId);
        try {
          await loadWhisperModel();
          console.log('[App] Whisper model loaded');
        } catch (err) {
          console.error('[App] Failed to load Whisper model:', err);
        }
      }

      // Load image models list
      const imageModels = await modelManager.getDownloadedImageModels();
      setDownloadedImageModels(imageModels);

      // Get current active model IDs from persisted store
      const currentState = useAppStore.getState();
      const currentActiveModelId = currentState.activeModelId;
      const currentActiveImageModelId = currentState.activeImageModelId;

      // Background load active text model (non-blocking)
      if (currentActiveModelId) {
        const textModel = downloadedModels.find(m => m.id === currentActiveModelId);
        if (textModel) {
          console.log('[App] Background loading text model:', textModel.name);
          llmService.loadModel(textModel.path, textModel.mmprojPath || undefined)
            .then(() => console.log('[App] Text model loaded successfully'))
            .catch(err => console.error('[App] Failed to load text model:', err));
        }
      }

      // Background load active image model (non-blocking)
      if (currentActiveImageModelId) {
        const imageModel = imageModels.find(m => m.id === currentActiveImageModelId);
        if (imageModel) {
          console.log('[App] Background loading image model:', imageModel.name);
          onnxImageGeneratorService.loadModel(imageModel.path)
            .then(() => console.log('[App] Image model loaded successfully'))
            .catch(err => console.error('[App] Failed to load image model:', err));
        }
      }
    } catch (error) {
      console.error('Error initializing app:', error);
    } finally {
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
          <View style={styles.loadingContainer}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Show lock screen if auth is enabled and app is locked
  if (authEnabled && isLocked) {
    return (
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
          <LockScreen onUnlock={handleUnlock} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: COLORS.primary,
            background: COLORS.background,
            card: COLORS.surface,
            text: COLORS.text,
            border: COLORS.border,
            notification: COLORS.primary,
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
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default App;
