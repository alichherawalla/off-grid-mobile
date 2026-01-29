import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, QUANTIZATION_INFO, CREDIBILITY_LABELS } from '../constants';
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
  onPress,
  onDownload,
  onDelete,
  onSelect,
}) => {
  const quantInfo = file
    ? QUANTIZATION_INFO[file.quantization] || null
    : downloadedModel
    ? QUANTIZATION_INFO[downloadedModel.quantization] || null
    : null;

  const fileSize = file?.size || downloadedModel?.fileSize || 0;

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

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardActive: {
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  cardIncompatible: {
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  titleContainer: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  author: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 8,
  },
  credibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  credibilityIcon: {
    fontSize: 10,
    fontWeight: '700',
  },
  credibilityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  activeBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  activeBadgeText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  infoBadge: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sizeBadge: {
    backgroundColor: COLORS.primary + '20',
  },
  infoText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  recommendedBadge: {
    backgroundColor: COLORS.secondary + '30',
  },
  recommendedText: {
    color: COLORS.secondary,
  },
  warningBadge: {
    backgroundColor: COLORS.warning + '30',
  },
  warningText: {
    color: COLORS.warning,
    fontSize: 12,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  statsText: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  progressText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    width: 40,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  downloadButton: {
    backgroundColor: COLORS.primary,
  },
  selectButton: {
    backgroundColor: COLORS.secondary,
  },
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  actionButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButtonText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '600',
  },
});
