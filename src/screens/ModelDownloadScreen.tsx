import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, ModelCard } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { RECOMMENDED_MODELS, TYPOGRAPHY } from '../constants';
import { useAppStore } from '../stores';
import { hardwareService, huggingFaceService, modelManager } from '../services';
import { ModelFile, DownloadedModel } from '../types';
import { RootStackParamList } from '../navigation/types';

type ModelDownloadScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ModelDownload'>;
};

export const ModelDownloadScreen: React.FC<ModelDownloadScreenProps> = ({
  navigation,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [recommendedModels, setRecommendedModels] = useState<typeof RECOMMENDED_MODELS>([]);
  const [modelFiles, setModelFiles] = useState<Record<string, ModelFile[]>>({});
  const [_selectedModel, setSelectedModel] = useState<string | null>(null);
  const [_selectedFile, setSelectedFile] = useState<ModelFile | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const {
    deviceInfo,
    setDeviceInfo,
    setModelRecommendation,
    downloadProgress,
    setDownloadProgress,
    addDownloadedModel,
    setActiveModelId,
  } = useAppStore();

  useEffect(() => {
    initializeHardwareAndModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializeHardwareAndModels = async () => {
    try {
      // Get device info
      const info = await hardwareService.getDeviceInfo();
      setDeviceInfo(info);

      const recommendation = hardwareService.getModelRecommendation();
      setModelRecommendation(recommendation);

      // Filter recommended models based on device capability
      const totalRamGB = hardwareService.getTotalMemoryGB();
      const compatibleModels = RECOMMENDED_MODELS.filter(
        (m) => m.minRam <= totalRamGB
      );
      setRecommendedModels(compatibleModels);

      // Fetch files for the first few compatible models
      const filesToFetch = compatibleModels.slice(0, 3);
      const filesMap: Record<string, ModelFile[]> = {};

      await Promise.all(
        filesToFetch.map(async (model) => {
          try {
            const files = await huggingFaceService.getModelFiles(model.id);
            // Filter for Q4_K_M or similar recommended quantizations
            const recommendedFiles = files.filter((f) =>
              ['Q4_K_M', 'Q4_K_S', 'Q4_0'].some((q) =>
                f.quantization.toUpperCase().includes(q.replace('_', ''))
              )
            );
            filesMap[model.id] = recommendedFiles.length > 0 ? recommendedFiles : files.slice(0, 2);
          } catch (error) {
            console.error(`Error fetching files for ${model.id}:`, error);
          }
        })
      );

      setModelFiles(filesMap);
    } catch (error) {
      console.error('Error initializing:', error);
      setAlertState(showAlert('Error', 'Failed to initialize. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    setSelectedModel(modelId);

    // Fetch files if not already loaded
    if (!modelFiles[modelId]) {
      try {
        const files = await huggingFaceService.getModelFiles(modelId);
        setModelFiles((prev) => ({ ...prev, [modelId]: files }));
      } catch (_error) {
        setAlertState(showAlert('Error', 'Failed to fetch model files.'));
      }
    }
  };

  const handleDownload = async (modelId: string, file: ModelFile) => {
    setSelectedFile(file);
    const downloadKey = `${modelId}/${file.name}`;

    const onProgress = (progress: {progress: number; bytesDownloaded: number; totalBytes: number}) => {
      setDownloadProgress(downloadKey, {
        progress: progress.progress,
        bytesDownloaded: progress.bytesDownloaded,
        totalBytes: progress.totalBytes,
      });
    };
    const onComplete = (model: DownloadedModel) => {
      setDownloadProgress(downloadKey, null);
      addDownloadedModel(model);
      setActiveModelId(model.id);

      // Navigate to home/chat
      setAlertState(showAlert(
        'Download Complete!',
        `${model.name} is ready to use. Let's start chatting!`,
        [
          {
            text: 'Start Chatting',
            onPress: () => navigation.replace('Main'),
          },
        ]
      ));
    };
    const onError = (error: Error) => {
      setDownloadProgress(downloadKey, null);
      setAlertState(showAlert('Download Failed', error.message));
    };

    try {
      if (modelManager.isBackgroundDownloadSupported()) {
        await modelManager.downloadModelBackground(modelId, file, onProgress, onComplete, onError);
      } else {
        await modelManager.downloadModel(modelId, file, onProgress, onComplete, onError);
      }
    } catch (error) {
      setAlertState(showAlert('Download Failed', (error as Error).message));
    }
  };

  const handleSkip = () => {
    navigation.replace('Main');
  };

  const totalRamGB = hardwareService.getTotalMemoryGB();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View testID="model-download-loading" style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Analyzing your device...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View testID="model-download-screen" style={{flex: 1}}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Download Your First Model</Text>
          <Text style={styles.subtitle}>
            Based on your device ({totalRamGB.toFixed(1)}GB RAM), we recommend
            these models for the best experience:
          </Text>
        </View>

        <Card style={styles.deviceCard}>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceLabel}>Your Device</Text>
            <Text style={styles.deviceValue}>{deviceInfo?.deviceModel}</Text>
          </View>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceLabel}>Available Memory</Text>
            <Text style={styles.deviceValue}>
              {hardwareService.formatBytes(deviceInfo?.availableMemory || 0)}
            </Text>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Recommended Models</Text>

        {recommendedModels.map((model, index) => {
          const files = modelFiles[model.id] || [];
          const recommendedFile = files[0]; // First file is usually the recommended one
          const downloadKey = recommendedFile
            ? `${model.id}/${recommendedFile.name}`
            : '';
          const progress = downloadProgress[downloadKey];
          const isDownloading = !!progress;

          return (
            <ModelCard
              key={model.id}
              testID={`recommended-model-${index}`}
              model={{
                id: model.id,
                name: model.name,
                author: model.id.split('/')[0],
                description: model.description,
              }}
              file={recommendedFile}
              isDownloading={isDownloading}
              downloadProgress={progress?.progress}
              isCompatible={model.minRam <= totalRamGB}
              onPress={() => handleSelectModel(model.id)}
              onDownload={
                recommendedFile
                  ? () => handleDownload(model.id, recommendedFile)
                  : undefined
              }
            />
          );
        })}

        {recommendedModels.length === 0 && (
          <Card style={styles.warningCard}>
            <Text style={styles.warningTitle}>Limited Compatibility</Text>
            <Text style={styles.warningText}>
              Your device has limited memory. You can still browse and download
              smaller models from the model browser.
            </Text>
          </Card>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Skip for Now"
          variant="ghost"
          onPress={handleSkip}
          testID="model-download-skip"
        />
      </View>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 16,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  deviceCard: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 24,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceLabel: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginBottom: 4,
  },
  deviceValue: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: 16,
  },
  warningCard: {
    backgroundColor: colors.warning + '20',
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warningTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.warning,
    marginBottom: 8,
  },
  warningText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  footer: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
