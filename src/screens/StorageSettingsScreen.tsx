import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components';
import { COLORS } from '../constants';
import { useAppStore, useChatStore } from '../stores';
import { hardwareService, modelManager } from '../services';

export const StorageSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const [storageUsed, setStorageUsed] = useState(0);
  const [availableStorage, setAvailableStorage] = useState(0);

  const { downloadedModels } = useAppStore();
  const { conversations } = useChatStore();

  useEffect(() => {
    loadStorageInfo();
  }, [downloadedModels]);

  const loadStorageInfo = async () => {
    const used = await modelManager.getStorageUsed();
    const available = await modelManager.getAvailableStorage();
    setStorageUsed(used);
    setAvailableStorage(available);
  };

  const totalStorage = storageUsed + availableStorage;
  const usedPercentage = totalStorage > 0 ? (storageUsed / totalStorage) * 100 : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Storage</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Storage Usage</Text>

          <View style={styles.storageBar}>
            <View style={[styles.storageUsed, { width: `${Math.min(usedPercentage, 100)}%` }]} />
          </View>

          <View style={styles.storageLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.primary }]} />
              <Text style={styles.legendText}>Used: {hardwareService.formatBytes(storageUsed)}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.surfaceLight }]} />
              <Text style={styles.legendText}>Free: {hardwareService.formatBytes(availableStorage)}</Text>
            </View>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Breakdown</Text>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="cpu" size={18} color={COLORS.primary} />
              <Text style={styles.infoLabel}>Downloaded Models</Text>
            </View>
            <Text style={styles.infoValue}>{downloadedModels.length}</Text>
          </View>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="hard-drive" size={18} color={COLORS.primary} />
              <Text style={styles.infoLabel}>Model Storage</Text>
            </View>
            <Text style={styles.infoValue}>{hardwareService.formatBytes(storageUsed)}</Text>
          </View>

          <View style={[styles.infoRow, styles.lastRow]}>
            <View style={styles.infoRowLeft}>
              <Icon name="message-circle" size={18} color={COLORS.primary} />
              <Text style={styles.infoLabel}>Conversations</Text>
            </View>
            <Text style={styles.infoValue}>{conversations.length}</Text>
          </View>
        </Card>

        {downloadedModels.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Models</Text>
            {downloadedModels.map((model, index) => (
              <View
                key={model.id}
                style={[
                  styles.modelRow,
                  index === downloadedModels.length - 1 && styles.lastRow
                ]}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
                  <Text style={styles.modelMeta}>{model.quantization}</Text>
                </View>
                <Text style={styles.modelSize}>{hardwareService.formatModelSize(model)}</Text>
              </View>
            ))}
          </Card>
        )}

        <Text style={styles.hint}>
          To free up space, you can delete models from the Models tab.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  placeholder: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  storageBar: {
    height: 12,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 12,
  },
  storageUsed: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
  },
  storageLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoLabel: {
    fontSize: 15,
    color: COLORS.text,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  modelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modelInfo: {
    flex: 1,
    marginRight: 12,
  },
  modelName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  modelMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  modelSize: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  hint: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
