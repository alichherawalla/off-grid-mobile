/**
 * TranscriptionModelsTab
 *
 * The "Transcription Models" tab on the Models screen: on-device speech-to-text
 * (Whisper) models. Shows the built-in ggml catalogue (English + multilingual),
 * rendered with the shared ModelCard so it matches the Text, Image, and Voice
 * tabs.
 *
 * Whisper is a core feature, so this tab is always available (no pro gating).
 * The whisper store tracks a single active model; downloading another switches
 * the active one.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { useWhisperStore } from '../../stores';
import { useSttDownloadState } from '../../hooks/useSttDownloadState';
import { WHISPER_MODELS, whisperService } from '../../services';
import {
  listSttModels,
  type SttModel,
} from '../../services/modelDownloadService/providers/sttModelRegistry';
import { createStyles as createModelsScreenStyles } from './styles';
import logger from '../../utils/logger';

const ENGLISH_MODELS = WHISPER_MODELS.filter(m => m.lang === 'en');
const MULTI_MODELS = WHISPER_MODELS.filter(m => m.lang === 'multi');

const BYTES_PER_MB = 1024 * 1024;

const formatSize = (mb: number): string => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`);

interface WhisperCardProps {
  model: typeof WHISPER_MODELS[number];
  index: number;
  downloadedModelId: string | null;
  presentModelIds: string[];
  downloading: boolean;
  queued: boolean;
  downloadProgress: number;
  onDownload: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const WhisperCard: React.FC<WhisperCardProps> = ({
  model, index, downloadedModelId, presentModelIds, downloading, queued, downloadProgress, onDownload, onSelect, onDelete,
}) => {
  const present = presentModelIds.includes(model.id);
  const active = downloadedModelId === model.id;
  // iOS only: is this downloaded model's CoreML (Neural Engine) encoder present & valid?
  // Drives the ANE/CPU badge so users can see which models run on the Neural Engine.
  const [coreMLStatus, setCoreMLStatus] = useState<'ready' | 'unavailable' | undefined>(undefined);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !present || !model.coreMLUrl) {
      setCoreMLStatus(undefined);
      return;
    }
    let cancelled = false;
    whisperService
      .hasCoreMLEncoder(model.id)
      .then((ok) => { if (!cancelled) setCoreMLStatus(ok ? 'ready' : 'unavailable'); })
      .catch(() => { if (!cancelled) setCoreMLStatus('unavailable'); });
    return () => { cancelled = true; };
  }, [present, model.id, model.coreMLUrl]);
  // WHISPER_MODELS sizes are in MB. Surface bytes so the STT card matches the
  // Text/Image cards ("X MB / Y MB"); for a queued model this reads "0 B / 142 MB".
  const totalBytes = model.size * 1024 * 1024;
  const downloadBytes = (downloading || queued)
    ? { downloaded: Math.round(downloadProgress * totalBytes), total: totalBytes }
    : undefined;
  return (
    <ModelCard
      compact
      model={{ id: model.id, name: model.name, author: formatSize(model.size), description: model.description }}
      isDownloaded={present && !downloading && !queued}
      isActive={active}
      isDownloading={downloading}
      isQueued={queued}
      downloadProgress={downloadProgress}
      downloadBytes={downloadBytes}
      coreMLStatus={coreMLStatus}
      testID={`transcription-model-card-${index}`}
      // Present but not active → tap to use; not present → tap to download.
      onPress={downloading ? undefined : (present ? (active ? undefined : () => onSelect(model.id)) : () => onDownload(model.id))}
      onDownload={!present && !downloading ? () => onDownload(model.id) : undefined}
      onDelete={present ? () => onDelete(model.id) : undefined}
    />
  );
};

/**
 * A speech model contributed through `sttModelRegistry` rather than shipped in the whisper
 * catalogue. This tab used to render `WHISPER_MODELS` directly, so a registered model was
 * invisible here no matter what the download provider knew about it - the reason Parakeet was
 * downloadable and manageable from the Download Manager yet absent from the Models screen.
 *
 * Core stays ignorant of what is registered: the row is built entirely from the registry's
 * hooks (`filesPresent`, `download`, `remove`), so this works for any future model without
 * core importing pro.
 */
const RegisteredSttCard: React.FC<{
  model: SttModel;
  index: number;
  onChanged: () => void;
}> = ({ model, index, onChanged }) => {
  const [present, setPresent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const probe = useCallback(() => {
    let alive = true;
    model.filesPresent()
      .then((p) => { if (alive) setPresent(p); })
      .catch(() => { if (alive) setPresent(false); });
    return () => { alive = false; };
  }, [model]);
  useEffect(() => probe(), [probe]);

  const sizeMb = Math.round(model.sizeBytes / BYTES_PER_MB);

  const download = (): void => {
    setBusy(true);
    // The registrant owns the transport and drives its own progress into the shared
    // downloadStore, so the Download Manager shows the combined bar. This screen only needs
    // to know when it finished, to re-probe disk.
    model.download()
      .catch((e) => logger.error(`[Transcription] ${model.id} download failed:`, e))
      .finally(() => { setBusy(false); probe(); onChanged(); });
  };

  const remove = (): void => {
    if (!model.remove) return;
    model.remove()
      .catch((e) => logger.error(`[Transcription] ${model.id} remove failed:`, e))
      .finally(() => { probe(); onChanged(); });
  };

  return (
    <ModelCard
      compact
      model={{
        id: model.id,
        name: model.displayName,
        author: `${sizeMb} MB`,
        // The licence credit rides on the card, which is the one place a person browsing
        // models will see it (Parakeet is CC-BY-4.0 and requires attribution).
        description: model.attribution ?? 'Speech-to-text model',
      }}
      isDownloaded={present === true && !busy}
      isDownloading={busy}
      downloadProgress={0}
      testID={`transcription-registered-card-${index}`}
      onPress={present === true || busy ? undefined : download}
      onDownload={present === true || busy ? undefined : download}
      onDelete={present === true && model.remove ? remove : undefined}
    />
  );
};

export const TranscriptionModelsTab: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Reuse the Models screen's shared banner styling so it matches the other tabs.
  const shared = useThemedStyles(createModelsScreenStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const {
    downloadedModelId, presentModelIds, downloadModel,
    selectModel, deleteModelById, refreshPresentModels, error: whisperError, clearError,
  } = useWhisperStore();

  // In-flight STT state from the SINGLE owner (canonical download tracker + whisper-store
  // fallback), shared with the Home "Speech" picker so the two surfaces can never disagree.
  // A failed entry reports active=false, so a stuck "downloading" bar can't linger while the
  // Download Manager shows "failed" — the model just becomes downloadable again. Disk probes
  // are deferred until nothing is downloading so an in-flight file isn't mistaken for absent.
  const { stateFor: downloadStateFor, anyDownloading } = useSttDownloadState();

  // Registered (non-whisper) speech models. Read on focus rather than once at module load,
  // because registration happens during pro activation - which can land after this module is
  // first evaluated, and can happen again when Pro is unlocked at runtime.
  const [registered, setRegistered] = useState<SttModel[]>(() => listSttModels());
  useFocusEffect(
    useCallback(() => { setRegistered(listSttModels()); }, []),
  );

  // Probe disk on mount and whenever downloads finish, so every on-disk model
  // (not just the active one) shows as downloaded.
  useEffect(() => {
    if (!anyDownloading) refreshPresentModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDownloading]);

  // Re-derive from disk whenever the Models screen regains focus (e.g. returning
  // from the Download Manager after a download or delete). Disk is the source of
  // truth, so this keeps the list in sync without any cross-screen wiring.
  useFocusEffect(
    useCallback(() => {
      if (!anyDownloading) refreshPresentModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anyDownloading]),
  );

  const handleDownload = useCallback((id: string) => {
    // The store owns downloadingId (set/cleared in downloadModel), so a download
    // started here — or from the chat voice button — shows progress on this tab.
    downloadModel(id).catch(err => logger.error('[Transcription] download failed:', err));
  }, [downloadModel]);

  const handleSelect = useCallback((id: string) => {
    selectModel(id).catch(err => logger.error('[Transcription] select failed:', err));
  }, [selectModel]);

  const handleDelete = useCallback((id: string) => {
    setAlertState(showAlert('Remove Transcription Model', 'This deletes the model files for this language/size.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { setAlertState(hideAlert()); deleteModelById(id); } },
    ]));
  }, [deleteModelById]);

  const renderWhisperCard = (model: typeof WHISPER_MODELS[number], index: number) => {
    const state = downloadStateFor(model.id);
    return (
      <WhisperCard
        key={model.id}
        model={model}
        index={index}
        downloadedModelId={downloadedModelId}
        presentModelIds={presentModelIds}
        downloading={state?.downloading ?? false}
        queued={state?.queued ?? false}
        downloadProgress={state?.progress ?? 0}
        onDownload={handleDownload}
        onSelect={handleSelect}
        onDelete={handleDelete}
      />
    );
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={shared.deviceBanner}>
        <Icon name="shield" size={11} color={colors.trending} />
        <Text style={shared.deviceBannerText}>Transcription runs on your phone, audio is never sent anywhere</Text>
      </View>

      {whisperError && (
        <TouchableOpacity onPress={clearError}>
          <Text style={styles.error}>{whisperError} (tap to dismiss)</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionLabel}>English only</Text>
      {ENGLISH_MODELS.map((m, i) => renderWhisperCard(m, i))}

      <Text style={styles.sectionLabel}>Multilingual - 99 languages</Text>
      {MULTI_MODELS.map((m, i) => renderWhisperCard(m, ENGLISH_MODELS.length + i))}

      {/* Models contributed by a registrant rather than the whisper catalogue. The section only
          appears when something registered - on iOS nothing does, so the tab looks exactly as it
          did. Whatever registers decides its own platform availability; this renders the list. */}
      {registered.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Other engines</Text>
          {registered.map((m, i) => (
            <RegisteredSttCard key={m.id} model={m} index={i} onChanged={refreshPresentModels} />
          ))}
        </>
      ) : null}

      <CustomAlert visible={alertState.visible} title={alertState.title}
        message={alertState.message} buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())} />
    </ScrollView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) =>
  ({
    flex: { flex: 1 },
    content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xs, paddingBottom: SPACING.xxl },
    sectionLabel: {
      ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted,
      letterSpacing: 0.3, marginBottom: SPACING.sm, marginTop: SPACING.xs,
    },
    error: { ...TYPOGRAPHY.bodySmall, color: colors.error, textAlign: 'center' as const, marginBottom: SPACING.md },
  });
