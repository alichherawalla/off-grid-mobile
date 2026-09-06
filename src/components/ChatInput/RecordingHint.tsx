import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { LoadingDots } from '../LoadingDots';
import { createStyles } from './styles';
import type { VoiceRecordInteractionMode } from '../VoiceRecordButton';

const processingLabel = (
  processing: 'loading' | 'starting' | 'transcribing',
): string => {
  if (processing === 'loading') return 'Loading voice model...';
  if (processing === 'starting') return 'Starting microphone...';
  return 'Transcribing...';
};

/**
 * Voice interaction status shown INLINE in the composer while recording:
 * a recording dot on the left and "‹ Slide to cancel" centred. The mic sits to the right, outside
 * the pill, where the thumb is. Living in the composer (not as a floating pill over the mic) keeps
 * it always visible and never overlapping the mic (device 2026-07-15).
 */
export const RecordingHint: React.FC<{
  /** Hands-free: the mic is open but nobody has spoken, so nothing is being captured yet. */
  awaitingSpeech?: boolean;
  interactionMode?: VoiceRecordInteractionMode;
  processing?: 'loading' | 'starting' | 'transcribing';
}> = ({ awaitingSpeech = false, interactionMode = 'idle', processing }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (processing) {
    return (
      <View style={styles.recordingRow} testID={`${processing}-voice-hint`}>
        <LoadingDots
          color={colors.textMuted}
          size={5}
          testID={`${processing}-voice-loader`}
        />
        <View style={styles.slideToCancel}>
          <Text style={styles.slideToCancelText}>{processingLabel(processing)}</Text>
        </View>
      </View>
    );
  }
  if (interactionMode === 'locked') {
    return (
      <View style={styles.recordingRow} testID="tap-to-stop-hint">
        <View style={styles.recordingDot} />
        <View style={styles.slideToCancel}>
          <Text style={styles.slideToCancelText}>Tap mic to stop</Text>
        </View>
      </View>
    );
  }
  // Hands-free opens the recorder BEFORE the turn begins, so the red dot and "slide to cancel" were
  // shown at someone whose words were not being captured yet. Waiting says so instead.
  if (awaitingSpeech) {
    return (
      <View style={styles.recordingRow} testID="awaiting-speech-hint">
        <Icon name="mic" size={16} color={colors.textMuted} />
        <View style={styles.slideToCancel}>
          <Text style={styles.slideToCancelText}>Waiting for your voice</Text>
        </View>
      </View>
    );
  }
  if (interactionMode === 'idle') {
    return (
      <View style={styles.recordingRow} testID="recording-starting-hint">
        <View style={styles.recordingDot} />
        <View style={styles.slideToCancel}>
          <Text style={styles.slideToCancelText}>Recording...</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.recordingRow} testID="recording-hint">
      <View style={styles.recordingDot} />
      <View style={styles.slideToCancel}>
        <Icon name="chevron-left" size={16} color={colors.textMuted} />
        <Text style={styles.slideToCancelText}>Slide to cancel</Text>
      </View>
    </View>
  );
};
