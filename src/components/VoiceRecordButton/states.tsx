import React from 'react';
import { View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { LoadingDots } from '../LoadingDots';
import { createStyles } from './styles';
import { ringQuadrants } from './derive';

// ─── Loading state ────────────────────────────────────────────────────────────

interface LoadingStateProps {
  asSendButton: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ asSendButton }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View testID="voice-loading" style={[styles.button, asSendButton ? styles.buttonAsSendLoading : styles.buttonAudioLoading]}>
      <LoadingDots color={colors.primary} size={asSendButton ? 4 : 5} />
    </View>
  );
};

// ─── Transcribing state ───────────────────────────────────────────────────────

interface TranscribingStateProps {
  asSendButton: boolean;
}

export const TranscribingState: React.FC<TranscribingStateProps> = ({ asSendButton }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.button, asSendButton ? styles.buttonAsSendLoading : styles.buttonAudioTranscribing]}>
      <LoadingDots color={colors.info} size={asSendButton ? 4 : 5} />
    </View>
  );
};

// ─── Unavailable state ────────────────────────────────────────────────────────

interface UnavailableButtonProps {
  asSendButton: boolean;
}

export const UnavailableButton: React.FC<UnavailableButtonProps> = ({ asSendButton }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (asSendButton) {
    return (
      <View style={[styles.button, styles.buttonAsSendUnavailable]}>
        <Icon name="mic-off" size={18} color={colors.textMuted} />
      </View>
    );
  }

  return (
    <View style={[styles.button, styles.buttonUnavailable]}>
      <View style={styles.micIcon}>
        <View style={[styles.micBody, styles.micBodyUnavailable]} />
        <View style={[styles.micBase, styles.micBodyUnavailable]} />
      </View>
      <View style={styles.unavailableSlash} />
    </View>
  );
};

// ─── Downloading state ────────────────────────────────────────────────────────

interface DownloadingButtonProps {
  asSendButton: boolean;
  /** In-flight STT download progress, 0..1. */
  progress: number;
}

/**
 * Background STT download: the unavailable-mic glyph inside a small DETERMINATE
 * download ring (static quadrant fill — clearly a download, never the rotating
 * busy spinner). The spinner is reserved for tap-triggered loads/transcription.
 */
export const DownloadingButton: React.FC<DownloadingButtonProps> = ({ asSendButton, progress }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [top, right, bottom, left] = ringQuadrants(progress);
  const fill = (filled: boolean) => (filled ? colors.primary : colors.border);

  return (
    <View
      testID="voice-mic-download-progress"
      accessibilityLabel={`Downloading voice model ${Math.round(progress * 100)}%`}
      style={[
        styles.button,
        asSendButton ? styles.buttonAsSendDownloading : styles.buttonDownloadRing,
        {
          borderTopColor: fill(top),
          borderRightColor: fill(right),
          borderBottomColor: fill(bottom),
          borderLeftColor: fill(left),
        },
      ]}
    >
      <Icon name="mic-off" size={asSendButton ? 18 : 16} color={colors.textMuted} />
    </View>
  );
};

// ─── Button icon ──────────────────────────────────────────────────────────────

interface ButtonIconProps {
  asSendButton: boolean;
  isRecording: boolean;
  size?: number;
}

export const ButtonIcon: React.FC<ButtonIconProps> = ({ asSendButton: _asSendButton, isRecording, size = 18 }) => {
  const { colors } = useTheme();
  const iconColor = isRecording ? colors.surface : colors.primary;
  return <Icon name="mic" size={size} color={iconColor} />;
};
