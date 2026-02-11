import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { QUANTIZATION_INFO, CREDIBILITY_LABELS, TYPOGRAPHY } from '../constants';
import { ModelFile, DownloadedModel, ModelCredibility } from '../types';
import { huggingFaceService } from '../services/huggingface';

interface ModelCardProps {
  model: {
    id: string;
    name: string;
    author: string;
    description?: string;
    downloads?: number;
    likes?: number;
    credibility?: ModelCredibility;
    files?: ModelFile[];
  };
  file?: ModelFile;
  downloadedModel?: DownloadedModel;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  downloadProgress?: number;
  isActive?: boolean;
  isCompatible?: boolean;
  testID?: string;
  onPress?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onSelect?: () => void;
}

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  file,
  downloadedModel,
  isDownloaded,
  isDownloading,
  downloadProgress = 0,
  isActive,
  isCompatible = true,
  testID,
  onPress,
  onDownload,
  onDelete,
  onSelect,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const quantInfo = file
    ? QUANTIZATION_INFO[file.quantization] || null
    : downloadedModel
    ? QUANTIZATION_INFO[downloadedModel.quantization] || null
    : null;

  // Calculate total size including mmproj if present
  const mainFileSize = file?.size || downloadedModel?.fileSize || 0;
  const mmProjSize = file?.mmProjFile?.size || downloadedModel?.mmProjFileSize || 0;
  const fileSize = mainFileSize + mmProjSize;

  // Check if this is a vision model
  const isVisionModel = !!(file?.mmProjFile || downloadedModel?.isVisionModel);

  // Calculate size range from model files (for browsing view)
  const sizeRange = React.useMemo(() => {
    if (fileSize > 0 || !model.files || model.files.length === 0) {
      return null;
    }
    const sizes = model.files.map(f => f.size).filter(s => s > 0);
    if (sizes.length === 0) return null;
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    return { min: minSize, max: maxSize, count: model.files.length };
  }, [model.files, fileSize]);

  // Get credibility info from model or downloaded model
  const credibility = model.credibility || downloadedModel?.credibility;
  const credibilityInfo = credibility ? CREDIBILITY_LABELS[credibility.source] : null;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isActive && styles.cardActive,
        !isCompatible && styles.cardIncompatible,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
      testID={testID}
    >
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={styles.name} numberOfLines={1}>
            {model.name}
          </Text>
          <View style={styles.authorRow}>
            <Text style={styles.author}>{model.author}</Text>
            {credibilityInfo && (
              <View style={[styles.credibilityBadge, { backgroundColor: credibilityInfo.color + '25' }]}>
                {credibility?.source === 'lmstudio' && (
                  <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>★</Text>
                )}
                {credibility?.source === 'official' && (
                  <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>✓</Text>
                )}
                {credibility?.source === 'verified-quantizer' && (
                  <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>◆</Text>
                )}
                <Text style={[styles.credibilityText, { color: credibilityInfo.color }]}>
                  {credibilityInfo.label}
                </Text>
              </View>
            )}
          </View>
        </View>
        {isActive && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>Active</Text>
          </View>
        )}
      </View>

      {model.description && (
        <Text style={styles.description} numberOfLines={2}>
          {model.description}
        </Text>
      )}

      <View style={styles.infoRow}>
        {fileSize > 0 && (
          <View style={styles.infoBadge}>
            <Text style={styles.infoText}>
              {huggingFaceService.formatFileSize(fileSize)}
            </Text>
          </View>
        )}
        {sizeRange && (
          <View style={[styles.infoBadge, styles.sizeBadge]}>
            <Text style={styles.infoText}>
              {sizeRange.min === sizeRange.max
                ? huggingFaceService.formatFileSize(sizeRange.min)
                : `${huggingFaceService.formatFileSize(sizeRange.min)} - ${huggingFaceService.formatFileSize(sizeRange.max)}`}
            </Text>
          </View>
        )}
        {sizeRange && (
          <View style={styles.infoBadge}>
            <Text style={styles.infoText}>
              {sizeRange.count} {sizeRange.count === 1 ? 'file' : 'files'}
            </Text>
          </View>
        )}
        {quantInfo && (
          <View
            style={[
              styles.infoBadge,
              quantInfo.recommended && styles.recommendedBadge,
            ]}
          >
            <Text
              style={[
                styles.infoText,
                quantInfo.recommended && styles.recommendedText,
              ]}
            >
              {file?.quantization || downloadedModel?.quantization}
            </Text>
          </View>
        )}
        {quantInfo && (
          <View style={styles.infoBadge}>
            <Text style={styles.infoText}>{quantInfo.quality}</Text>
          </View>
        )}
        {isVisionModel && (
          <View style={styles.visionBadge}>
            <Text style={styles.visionText}>Vision</Text>
          </View>
        )}
        {!isCompatible && (
          <View style={styles.warningBadge}>
            <Text style={styles.warningText}>Too large</Text>
          </View>
        )}
      </View>

      {model.downloads !== undefined && (
        <View style={styles.statsRow}>
          <Text style={styles.statsText}>
            {formatNumber(model.downloads)} downloads
          </Text>
          {model.likes !== undefined && model.likes > 0 && (
            <Text style={styles.statsText}>{formatNumber(model.likes)} likes</Text>
          )}
        </View>
      )}

      {isDownloading && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${downloadProgress * 100}%` }]}
            />
          </View>
          <Text style={styles.progressText}>
            {Math.round(downloadProgress * 100)}%
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        {!isDownloaded && !isDownloading && onDownload && (
          <TouchableOpacity
            style={[styles.actionButton, styles.downloadButton]}
            onPress={onDownload}
            disabled={!isCompatible}
            testID={testID ? `${testID}-download` : undefined}
          >
            <Text style={styles.actionButtonText}>Download</Text>
          </TouchableOpacity>
        )}
        {isDownloaded && !isActive && onSelect && (
          <TouchableOpacity
            style={[styles.actionButton, styles.selectButton]}
            onPress={onSelect}
          >
            <Text style={styles.actionButtonText}>Select</Text>
          </TouchableOpacity>
        )}
        {isDownloaded && onDelete && (
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={onDelete}
          >
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
};

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardActive: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  cardIncompatible: {
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 8,
  },
  titleContainer: {
    flex: 1,
  },
  name: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  author: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  authorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 2,
    gap: 8,
  },
  credibilityBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  credibilityIcon: {
    ...TYPOGRAPHY.meta,
    fontSize: 10,
  },
  credibilityText: {
    ...TYPOGRAPHY.meta,
  },
  activeBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  activeBadgeText: {
    ...TYPOGRAPHY.meta,
    color: colors.text,
  },
  description: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 8,
  },
  infoBadge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sizeBadge: {
    backgroundColor: colors.primary + '20',
  },
  infoText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  recommendedBadge: {
    backgroundColor: colors.info + '30',
  },
  recommendedText: {
    color: colors.info,
  },
  warningBadge: {
    backgroundColor: colors.warning + '30',
  },
  warningText: {
    ...TYPOGRAPHY.meta,
    color: colors.warning,
  },
  visionBadge: {
    backgroundColor: colors.info + '30',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  visionText: {
    ...TYPOGRAPHY.meta,
    color: colors.info,
  },
  statsRow: {
    flexDirection: 'row' as const,
    gap: 16,
    marginBottom: 12,
  },
  statsText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  progressContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%' as const,
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    width: 40,
    textAlign: 'right' as const,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center' as const,
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  downloadButton: {
    borderColor: colors.primary,
  },
  selectButton: {
    borderColor: colors.primary,
  },
  deleteButton: {
    borderColor: colors.error,
  },
  actionButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
  },
  deleteButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.error,
  },
});
