import { buildCuratedLiteRTFiles, curatedLiteRTDownloadWarning, getCuratedLiteRTEntry, LITERT_PARENT_ID, liteRTGpuUnsupportedNotice, stripModelFileExtension, uniformDownloadId } from '@offgrid/application';
import React, { useCallback, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TextInput, RefreshControl, TouchableOpacity, Platform, type ListRenderItemInfo } from 'react-native';
import { LoadingDots } from '../../components/LoadingDots';
import DeviceInfo from 'react-native-device-info';
import Icon from 'react-native-vector-icons/Feather';
import { ScreenHeader } from '../../components/ScreenHeader';
import { fileExceedsBudget } from '../../services/memoryBudget';
import { Card, ModelCard } from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { CustomAlert, hideAlert, showAlert, AlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import { CREDIBILITY_LABELS } from '../../constants';
import { ModelInfo, ModelFile } from '../../types';
import { createStyles } from './styles';
import { ModelsScreenViewModel } from './useModelsScreen';
import { useDownloadStore, isActiveStatus, isQueuedStatus } from '../../stores/downloadStore';
import { makeModelKey } from '../../utils/modelKey';
import { modelSupportsNpuGpu, isAccelerableQuant } from '../../utils/acceleration';
import { aggregateActiveDownloads } from '../../utils/downloadAggregate';
import { TextFiltersSection } from './TextFiltersSection';
import { FilterState, SortOption } from './types';
import { SORT_OPTIONS } from './constants';
import { formatNumber, getTextModelCompatibility } from './utils';
import { LITERT_FILE_META, LITERT_RECOMMENDED_MODEL, LITERT_PARENT_RECOMMENDED } from './litertRecommended';
import { repairDownloadedVisionMetadata } from '../../services/modelServices/modelMetadataRepairCommand';
import { modelDownloadRegistry } from '../../services/modelServices/downloadRegistryBootstrap';
import { fetchModelFiles } from '../../services/modelCatalogFiles';
import { huggingFaceService } from '../../services/huggingface';

function hasNonSortFilters(fs: FilterState): boolean {
  return fs.orgs.length > 0 || fs.type !== 'all' || fs.source !== 'all' || fs.size !== 'all' || fs.quant !== 'all';
}

function getEmptyText(hasSearched: boolean, hasActiveFilters: boolean): string {
  if (!hasSearched) return 'No recommended models available.';
  if (hasActiveFilters) return 'No models match your filters. Try adjusting or clearing them.';
  return 'No models found. Try a different search term.';
}

type Props = Pick<ModelsScreenViewModel,
  | 'searchQuery' | 'setSearchQuery' | 'isLoading' | 'isRefreshing' | 'hasSearched'
  | 'selectedModel' | 'setSelectedModel' | 'modelFiles' | 'setModelFiles' | 'isLoadingFiles'
  | 'filterState' | 'textFiltersVisible' | 'setTextFiltersVisible'
  | 'filteredResults' | 'recommendedAsModelInfo' | 'trendingAsModelInfo'
  | 'ramGB' | 'deviceRecommendation' | 'hasActiveFilters' | 'downloadedModels'
  | 'alertState' | 'setAlertState' | 'focusTrigger' | 'handleSearch' | 'handleRefresh'
  | 'handleSelectModel' | 'handleDownload' | 'handleRepairMmProj' | 'handleCancelDownload' | 'handleDeleteModel'
  | 'clearFilters' | 'toggleFilterDimension' | 'toggleOrg'
  | 'setTypeFilter' | 'setSourceFilter' | 'setSizeFilter' | 'setQuantFilter' | 'setSortOption'
  | 'isModelDownloaded' | 'getDownloadedModel' | 'isRepairingVisionModel'
> & { onboarding?: boolean };

type DetailProps = Pick<Props,
  | 'modelFiles' | 'isLoadingFiles' | 'filterState' | 'ramGB' | 'alertState' | 'setAlertState'
  | 'getDownloadedModel' | 'isModelDownloaded' | 'isRepairingVisionModel'
  | 'handleDownload' | 'handleRepairMmProj' | 'handleCancelDownload' | 'handleDeleteModel'
> & { selectedModel: ModelInfo; onBack: () => void; };

// Build the file card's onDownload handler. The curated confirm-download warning is the
// registry's single DEVICE-AWARE decision (curatedLiteRTDownloadWarning), never re-derived here.
function buildFileDownloadHandler({ s, fileName, sizeBytes, ramGB, proceedDownload, setAlertState }: {
  s: { downloaded: boolean; progress: unknown; hasFailed: boolean };
  fileName: string;
  sizeBytes: number; ramGB: number;
  proceedDownload: () => void;
  setAlertState: (state: AlertState) => void;
}): (() => void) | undefined {
  if (s.downloaded || s.progress || s.hasFailed) return undefined;
  return () => {
    const warning = curatedLiteRTDownloadWarning(fileName, sizeBytes, ramGB);
    if (warning) {
      setAlertState(showAlert(warning.title, warning.message, [
        { text: 'Cancel', style: 'cancel', onPress: () => setAlertState(hideAlert()) },
        { text: 'Download anyway', style: 'default', onPress: () => { setAlertState(hideAlert()); proceedDownload(); } },
      ]));
      return;
    }
    proceedDownload();
  };
}

const ModelDetailView: React.FC<DetailProps> = ({
  selectedModel, modelFiles, isLoadingFiles, filterState, ramGB,
  alertState, setAlertState, onBack,
  getDownloadedModel, isModelDownloaded, isRepairingVisionModel,
  handleDownload, handleRepairMmProj, handleCancelDownload, handleDeleteModel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Shared decides which devices lack a LiteRT GPU path; this screen only shows the sentence.
  const liteRTGpuNotice = liteRTGpuUnsupportedNotice({ platform: Platform.OS, deviceModel: DeviceInfo.getModel() });

  // Heal the durable vision flag from the authoritative catalog: this screen KNOWS a model is vision
  // (its repo ships an mmproj → modelFiles carry mmProjFile), so persist isVisionModel:true onto any
  // downloaded record that lost it. The Download Manager has no catalog, so the RECORD is the single
  // source both surfaces read — the wrench then shows consistently (device 2026-07-14).
  useEffect(() => {
    repairDownloadedVisionMetadata({
      modelId: selectedModel.id,
      files: modelFiles,
      resolveDownloaded: getDownloadedModel,
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel.id, modelFiles]);

  const storeDownloads = useDownloadStore(state => state.downloads);

  const getFileCardState = (item: ModelFile) => {
    const modelKey = makeModelKey(selectedModel.id, item.name);
    const entry = storeDownloads[modelKey];
    const downloaded = isModelDownloaded(selectedModel.id, item.name);
    const downloadedModel = getDownloadedModel(selectedModel.id, item.name);
    const needsVisionRepair = checkNeedsVisionRepair(downloadedModel, item);
    const repairingVision = isRepairingVisionModel(`${selectedModel.id}/${item.name}`);
    let progress = entry ? {
      progress: entry.progress,
      bytesDownloaded: entry.bytesDownloaded + (entry.mmProjBytesDownloaded ?? 0),
      totalBytes: entry.combinedTotalBytes,
      bytesPerSecond: entry.bytesPerSecond,
      status: entry.status,
    } : undefined;

    // For completed downloads, discard if size doesn't match expected
    if (progress && progress.status === 'completed' && progress.bytesDownloaded < item.size) {
      progress = undefined;
    }
    const canCancel   = !!entry && isActiveStatus(entry.status);
    const hasFailed   = entry?.status === 'failed';
    const errorMessage = hasFailed ? (entry?.errorMessage ?? 'Download failed') : undefined;
    return { downloadKey: modelKey, progress, downloaded, downloadedModel, needsVisionRepair, repairingVision, canCancel, hasFailed, errorMessage };
  };

  const renderFileItem = ({ item, index }: { item: ModelFile; index: number }) => {
    const s = getFileCardState(item);
    const proceedDownload = () => {
      handleDownload(selectedModel, item);
    };
    const onDownload = buildFileDownloadHandler({ s, fileName: item.name, sizeBytes: item.size, ramGB, proceedDownload, setAlertState });
    const liteRTMeta = LITERT_FILE_META[item.name];
    const displayName = liteRTMeta?.displayName ?? stripModelFileExtension(item.name);
    const recommended = liteRTMeta ? { pillLabel: 'Recommended', highlightText: liteRTMeta.highlight } : undefined;
    const storeEntry = storeDownloads[s.downloadKey];
    // Retry routes through the single owner (modelDownloadRegistry → textProvider): the provider owns
    // the platform decision AND the lost-downloadId case, so the failed card renders Retry regardless
    // of downloadId — gating on it here made iOS retry unreachable.
    const failedState = s.hasFailed && s.errorMessage && storeEntry ? {
      errorMessage: s.errorMessage,
      bytesDownloaded: storeEntry.bytesDownloaded,
      totalBytes: storeEntry.combinedTotalBytes || storeEntry.totalBytes,
      onRetry: () => { modelDownloadRegistry.retry(uniformDownloadId('text', s.downloadKey)).catch(() => {}); },
      onRemove: () => handleCancelDownload(s.downloadKey),
    } : undefined;
    return <ModelCard
        model={{ id: selectedModel.id, name: displayName, author: selectedModel.author, credibility: selectedModel.credibility }}
        file={item} downloadedModel={s.downloadedModel} isDownloaded={s.downloaded}
        isDownloading={!!s.progress && !s.hasFailed && !isQueuedStatus(s.progress.status)}
        isQueued={isQueuedStatus(s.progress?.status ?? 'completed')}
        downloadProgress={s.progress?.progress}
        downloadBytes={s.progress && !s.hasFailed ? {
          downloaded: s.progress.bytesDownloaded,
          total: s.progress.totalBytes,
          bytesPerSecond: s.progress.bytesPerSecond,
        } : undefined}
        isRepairingVision={s.repairingVision}
        isCompatible={!fileExceedsBudget(item.size, ramGB)} testID={`file-card-${index}`}
        onDownload={onDownload}
        onDelete={s.downloaded ? () => handleDeleteModel(`${selectedModel.id}/${item.name}`) : undefined}
        onRepairVision={s.needsVisionRepair && !s.progress && !s.repairingVision ? () => handleRepairMmProj(selectedModel, item) : undefined}
        onCancel={s.canCancel ? () => handleCancelDownload(s.downloadKey) : undefined}
        compact
        recommended={recommended}
        supportsAcceleration={isAccelerableQuant(item.quantization) || !!liteRTMeta}
        failedState={failedState}
      />;
  };

  return (
    <View testID="model-detail-screen" style={styles.flex1}>
      <ScreenHeader
        title={selectedModel.name}
        onBack={onBack}
        testID="model-detail-header"
      />
      <Card style={styles.modelInfoCard}>
        <View style={styles.authorRow}>
          <Text style={styles.modelAuthor}>{selectedModel.author}</Text>
          {selectedModel.credibility && (
            <View style={[styles.credibilityBadge, { backgroundColor: `${CREDIBILITY_LABELS[selectedModel.credibility.source].color}25` }]}>
              {selectedModel.credibility.source === 'lmstudio' && <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>★</Text>}
              {selectedModel.credibility.source === 'official' && <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>✓</Text>}
              {selectedModel.credibility.source === 'verified-quantizer' && <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>◆</Text>}
              <Text style={[styles.credibilityText, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>
                {CREDIBILITY_LABELS[selectedModel.credibility.source].label}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.modelDescription}>{selectedModel.description}</Text>
        {(selectedModel.downloads > 0 || selectedModel.likes > 0) && (
          <View style={styles.modelStats}>
            {selectedModel.downloads > 0 && (
              <Text style={styles.statText}>{formatNumber(selectedModel.downloads)} downloads</Text>
            )}
            {selectedModel.likes > 0 && (
              <Text style={styles.statText}>{formatNumber(selectedModel.likes)} likes</Text>
            )}
          </View>
        )}
      </Card>
      {selectedModel.id === LITERT_PARENT_ID && liteRTGpuNotice && (
        <Card style={styles.deviceBanner}>
          <Icon name="info" size={14} color={colors.trending} />
          <Text style={styles.deviceBannerText}>{liteRTGpuNotice}</Text>
        </Card>
      )}
      <Text style={styles.sectionTitle}>Available Files</Text>
      {selectedModel.id !== LITERT_PARENT_ID && (
        <Text style={styles.sectionSubtitle}>
          Choose a quantization level. Q4_K_M is recommended for mobile.
          {modelFiles.some(f => f.mmProjFile) && ' Vision files include mmproj.'}
        </Text>
      )}
      {isLoadingFiles ? (
        <View style={styles.loadingContainer}><LoadingDots color={colors.primary} size={8} /></View>
      ) : (
        <FlatList
          data={modelFiles
            .filter(f => f.size > 0 && !fileExceedsBudget(f.size, ramGB) && (filterState.quant === 'all' || f.name.includes(filterState.quant)))
            .sort((a, b) => {
              if (selectedModel.id === LITERT_PARENT_ID) return a.size - b.size; // curated: small-first
              // Tier: Q4_K_M (CPU default, lowest size) → GPU/NPU Q4_0/Q8_0 → rest (CPU
              // fallback). Accelerable tier small-first (Q4_0 before Q8_0); others size desc.
              const tier = (f: ModelFile) => f.name.includes('Q4_K_M') ? 0 : isAccelerableQuant(f.quantization) ? 1 : 2;
              if (tier(a) !== tier(b)) return tier(a) - tier(b);
              return tier(a) === 1 ? a.size - b.size : b.size - a.size;
            })}
          renderItem={renderFileItem}
          keyExtractor={item => item.name}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Card style={styles.emptyCard}><Text style={styles.emptyText}>No compatible files found for this model.</Text></Card>}
        />
      )}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </View>
  );
};

const DeviceBanner: React.FC<{ ramGB: number; rec: { maxParameters: number; recommendedQuantization: string }; showTitle: boolean; styles: any }> = ({ ramGB, rec, showTitle, styles }) => (
  <View>
    <View style={styles.deviceBanner}><Text style={styles.deviceBannerText}>{Math.round(ramGB)}GB RAM — models up to {rec.maxParameters}B recommended ({rec.recommendedQuantization})</Text></View>
    {showTitle && <Text style={styles.recommendedTitle}>Recommended for your device</Text>}
  </View>
);

interface ModelListItemProps {
  item: ModelInfo; index: number; focusTrigger: number;
  isDownloaded: boolean; isTrending: boolean;
  // The row takes the STABLE handlers and closes over its own item, so a memoized row is
  // not invalidated by a fresh arrow per parent render (which is what a keystroke causes).
  onSelect: (model: ModelInfo) => void;
  onDirectDownload?: (model: ModelInfo) => void;
}
const ModelListItemRow: React.FC<ModelListItemProps> = ({ item, index, focusTrigger, isDownloaded, isTrending, onSelect, onDirectDownload }) => {
  const { isCompatible, incompatibleReason } = getTextModelCompatibility(item);
  const onDownload = useMemo(() => (onDirectDownload ? () => onDirectDownload(item) : undefined), [onDirectDownload, item]);
  const onPress = useMemo(() => onDownload ?? (() => onSelect(item)), [onDownload, onSelect, item]);
  const isLiteRTParent = item.id === LITERT_PARENT_ID;
  const recommended = isLiteRTParent ? LITERT_PARENT_RECOMMENDED : undefined;
  // Aggregate ALL in-flight entries for this model (main+mmproj / grouped LiteRT) into
  // cumulative progress/bytes + a download count, so the card shows total, not one entry.
  const downloads = useDownloadStore(s => s.downloads);
  const agg = React.useMemo(() => aggregateActiveDownloads(downloads, item.id), [downloads, item.id]);
  // Strip files for the LiteRT parent so ModelCard skips the size-range / "N files"
  // badges (curated chips cover it); the original item still flows through onPress.
  const cardModel = isLiteRTParent ? { ...item, files: undefined } : item;
  return <AnimatedEntry index={index} staggerMs={30} trigger={focusTrigger}><ModelCard model={cardModel} isDownloaded={isDownloaded} isDownloading={agg.downloading} isQueued={agg.queued} downloadProgress={agg.progress} downloadBytes={agg.bytes} downloadCount={agg.count} isCompatible={isCompatible} incompatibleReason={incompatibleReason} onPress={isCompatible ? onPress : undefined} onDownload={isCompatible ? onDownload : undefined} testID={`model-card-${index}`} compact isTrending={isTrending} recommended={recommended} supportsAcceleration={!isLiteRTParent && modelSupportsNpuGpu(item)} /></AnimatedEntry>;
};

// Memoized: every row owns a download-store subscription, so without this one character
// re-ran that subscription for every row on screen.
const ModelListItem = React.memo(ModelListItemRow);
ModelListItem.displayName = 'ModelListItem';

function applyBackNavigation(setSelectedModel: (m: ModelInfo | null) => void, setModelFiles: (f: ModelFile[]) => void): void {
  setSelectedModel(null);
  setModelFiles([]);
}

interface SortPanelProps {
  filterState: FilterState;
  setSortOption: (s: SortOption) => void;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
}
const SortPanel: React.FC<SortPanelProps> = ({ filterState, setSortOption, styles, colors }) => (
  <View style={styles.filterExpandedContent}>
    <View style={styles.filterChipWrap}>
      {SORT_OPTIONS.map(option => (
        <TouchableOpacity key={option.key} style={[styles.filterChip, filterState.sort === option.key && styles.filterChipActive]} onPress={() => setSortOption(option.key)}>
          <Icon name={option.icon} size={12} color={filterState.sort === option.key ? colors.primary : colors.textSecondary} />
          <Text style={[styles.filterChipText, filterState.sort === option.key && styles.filterChipTextActive]}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

export const TextModelsTab: React.FC<Props> = (props) => {
  const {
    searchQuery, setSearchQuery, isLoading, isRefreshing, hasSearched,
    selectedModel, setSelectedModel, modelFiles, setModelFiles, isLoadingFiles,
    filterState, textFiltersVisible, setTextFiltersVisible,
    filteredResults, recommendedAsModelInfo, trendingAsModelInfo, ramGB, deviceRecommendation,
    hasActiveFilters, downloadedModels,
    alertState, setAlertState, focusTrigger,
    handleSearch, handleRefresh, handleSelectModel, handleDownload, handleRepairMmProj, handleCancelDownload, handleDeleteModel,
    clearFilters, toggleFilterDimension, toggleOrg,
    setTypeFilter, setSourceFilter, setSizeFilter, setQuantFilter, setSortOption,
    isModelDownloaded, getDownloadedModel, isRepairingVisionModel, onboarding = false,
  } = props;
  const hasNonSortActiveFilters = hasNonSortFilters(filterState);
  const currentSort = SORT_OPTIONS.find(o => o.key === filterState.sort) ?? SORT_OPTIONS[0];
  const isSortActive = filterState.sort !== 'recommended';
  const sortToggleActive = isSortActive || filterState.expandedDimension === 'sort';
  const filterToggleActive = textFiltersVisible || hasNonSortActiveFilters;

  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const downloadRecommendedFile = useCallback(async (item: ModelInfo) => {
    const files = await fetchModelFiles([item], huggingFaceService);
    const file = files[item.id]?.[0];
    if (!file) { setAlertState(showAlert('Download unavailable', 'No compatible Q4_K_M file was found.')); return; }
    await handleDownload(item, file);
  }, [handleDownload, setAlertState]);

  const onDirectDownload = useCallback((item: ModelInfo) => {
    downloadRecommendedFile(item).catch(() => undefined);
  }, [downloadRecommendedFile]);

  // Derived lookups memoized once per data change instead of rebuilt for every row on
  // every render, so a keystroke does not rescan the downloaded/trending lists N times.
  const downloadedModelIds = useMemo(() => downloadedModels.map(m => m.id), [downloadedModels]);
  const trendingModelIds = useMemo(() => new Set(trendingAsModelInfo.map(t => t.id)), [trendingAsModelInfo]);

  const renderModelItem = useCallback(({ item, index }: ListRenderItemInfo<ModelInfo>) => (
    <ModelListItem item={item} index={index} focusTrigger={focusTrigger} isDownloaded={downloadedModelIds.some(id => id.startsWith(item.id))} isTrending={trendingModelIds.has(item.id)} onSelect={handleSelectModel} onDirectDownload={onboarding ? onDirectDownload : undefined} />
  ), [downloadedModelIds, focusTrigger, handleSelectModel, onDirectDownload, onboarding, trendingModelIds]);

  const keyExtractor = useCallback((item: ModelInfo) => item.id, []);

  const onboardingLiteRTCards = useMemo(() => onboarding && Platform.OS === 'android'
    ? buildCuratedLiteRTFiles()
      .filter(file =>
        !fileExceedsBudget(file.size, ramGB) ||
        curatedLiteRTDownloadWarning(file.name, file.size, ramGB) !== null,
      )
      .map((file, index) => {
        const entry = getCuratedLiteRTEntry(file.name);
        const model = { ...LITERT_RECOMMENDED_MODEL, name: entry?.displayName ?? file.name };
        const startDownload = () => {
          handleDownload(model, file);
        };
        const guardedDownload = buildFileDownloadHandler({
          s: { downloaded: false, progress: null, hasFailed: false },
          fileName: file.name,
          sizeBytes: file.size,
          ramGB,
          proceedDownload: startDownload,
          setAlertState,
        });
        return (
          <ModelCard
            key={file.name}
            compact
            model={model}
            file={file}
            recommended={{ pillLabel: 'Recommended' }}
            supportsAcceleration
            testID={`onboarding-litert-model-${index}`}
            onPress={guardedDownload}
            onDownload={guardedDownload}
          />
        );
      })
    : null, [handleDownload, onboarding, ramGB, setAlertState]);

  const listData = useMemo(() => hasSearched
    ? filteredResults
    : [...(!onboarding && Platform.OS === 'android' ? [LITERT_RECOMMENDED_MODEL] : []), ...recommendedAsModelInfo],
  [filteredResults, hasSearched, onboarding, recommendedAsModelInfo]);

  const listHeader = useMemo(() => hasSearched ? null : (
    <><DeviceBanner ramGB={ramGB} rec={deviceRecommendation} showTitle={recommendedAsModelInfo.length > 0} styles={styles} />{onboardingLiteRTCards}</>
  ), [deviceRecommendation, hasSearched, onboardingLiteRTCards, ramGB, recommendedAsModelInfo.length, styles]);

  const listEmpty = useMemo(() => (
    <Card style={styles.emptyCard}><Text style={styles.emptyText}>{getEmptyText(hasSearched, hasActiveFilters)}</Text></Card>
  ), [hasActiveFilters, hasSearched, styles]);

  const onBack = useCallback(() => applyBackNavigation(setSelectedModel, setModelFiles), [setModelFiles, setSelectedModel]);

  if (selectedModel) {
    return (
      <ModelDetailView
        selectedModel={selectedModel}
        modelFiles={modelFiles}
        isLoadingFiles={isLoadingFiles}
        filterState={filterState}
        ramGB={ramGB}
        alertState={alertState}
        setAlertState={setAlertState}
        onBack={onBack}
        getDownloadedModel={getDownloadedModel}
        isModelDownloaded={isModelDownloaded}
        isRepairingVisionModel={isRepairingVisionModel}
        handleDownload={handleDownload}
        handleRepairMmProj={handleRepairMmProj}
        handleCancelDownload={handleCancelDownload}
        handleDeleteModel={handleDeleteModel}
      />
    );
  }

  return (
    <>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search Hugging Face models..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          testID="search-input"
        />
        <TouchableOpacity
          style={[styles.filterToggle, sortToggleActive && styles.filterToggleActive]}
          onPress={() => toggleFilterDimension('sort')}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          testID="sort-pill"
        >
          <Icon name={currentSort.icon} size={14} color={sortToggleActive ? colors.primary : colors.textMuted} />
          {isSortActive && <View style={styles.filterDot} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterToggle, filterToggleActive && styles.filterToggleActive]}
          onPress={() => setTextFiltersVisible(v => !v)}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          testID="text-filter-toggle"
        >
          <Icon name="sliders" size={14} color={filterToggleActive ? colors.primary : colors.textMuted} />
          {hasNonSortActiveFilters && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>

      {filterState.expandedDimension === 'sort' && <SortPanel filterState={filterState} setSortOption={setSortOption} styles={styles} colors={colors} />}

      {textFiltersVisible && (
        <TextFiltersSection
          filterState={filterState}
          hasActiveFilters={hasNonSortActiveFilters}
          clearFilters={clearFilters}
          toggleFilterDimension={toggleFilterDimension}
          toggleOrg={toggleOrg}
          setTypeFilter={setTypeFilter}
          setSourceFilter={setSourceFilter}
          setSizeFilter={setSizeFilter}
          setQuantFilter={setQuantFilter}
        />
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <LoadingDots color={colors.primary} size={8} />
          <Text style={styles.loadingText}>Loading models...</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          renderItem={renderModelItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          testID="models-list"
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
        />
      )}
    </>
  );
};
