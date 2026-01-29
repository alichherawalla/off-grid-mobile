import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, ModelCard } from '../components';
import { COLORS, RECOMMENDED_MODELS } from '../constants';
import { useAppStore } from '../stores';
import { hardwareService, huggingFaceService, modelManager } from '../services';
import { ModelFile } from '../types';
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
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<ModelFile | null>(null);

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
      Alert.alert('Error', 'Failed to initialize. Please try again.');
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
      } catch (error) {
        Alert.alert('Error', 'Failed to fetch model files.');
      }
    }
  };

  const handleDownload = async (modelId: string, file: ModelFile) => {
    setSelectedFile(file);
    const downloadKey = `${modelId}/${file.name}`;

    try {
      await modelManager.downloadModel(
        modelId,
        file,
        (progress) => {
          setDownloadProgress(downloadKey, {
            progress: progress.progress,
            bytesDownloaded: progress.bytesDownloaded,
            totalBytes: progress.totalBytes,
          });
        },
        (model) => {
          setDownloadProgress(downloadKey, null);
          addDownloadedModel(model);
          setActiveModelId(model.id);

          // Navigate to home/chat
          Alert.alert(
            'Download Complete!',
            `${model.name} is ready to use. Let's start chatting!`,
            [
              {
                text: 'Start Chatting',
                onPress: () => navigation.replace('Main'),
              },
            ]
          );
        },
        (error) => {
          setDownloadProgress(downloadKey, null);
          Alert.alert('Download Failed', error.message);
        }
      );
    } catch (error) {
      Alert.alert('Download Failed', (error as Error).message);
    }
  };

  const handleSkip = () => {
    navigation.replace('Main');
  };

  const totalRamGB = hardwareService.getTotalMemoryGB();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Analyzing your device...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
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

        {recommendedModels.map((model) => {
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
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 16,
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
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    lineHeight: 24,
  },
  deviceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  deviceValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  warningCard: {
    backgroundColor: COLORS.warning + '20',
    borderWidth: 1,
    borderColor: COLORS.warning,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.warning,
    marginBottom: 8,
  },
  warningText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
});
