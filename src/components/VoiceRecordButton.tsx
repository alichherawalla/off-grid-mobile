import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  Alert,
  Vibration,
} from 'react-native';
import { COLORS } from '../constants';

interface VoiceRecordButtonProps {
  isRecording: boolean;
  isAvailable: boolean;
  partialResult: string;
  error?: string | null;
  disabled?: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
}

const CANCEL_DISTANCE = 80;

export const VoiceRecordButton: React.FC<VoiceRecordButtonProps> = ({
  isRecording,
  isAvailable,
  partialResult,
  error,
  disabled,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const cancelOffsetX = useRef(new Animated.Value(0)).current;
  const isDraggingToCancel = useRef(false);

  // Use refs to avoid stale closures in PanResponder
  const callbacksRef = useRef({ onStartRecording, onStopRecording, onCancelRecording });
  callbacksRef.current = { onStartRecording, onStopRecording, onCancelRecording };

  // Pulse animation when recording
  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, pulseAnim]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        console.log('[VoiceButton] Press started');
        // Haptic feedback on press
        Vibration.vibrate(50);
        isDraggingToCancel.current = false;
        callbacksRef.current.onStartRecording();
      },
      onPanResponderMove: (
        _: GestureResponderEvent,
        gestureState: PanResponderGestureState
      ) => {
        const offsetX = Math.min(0, gestureState.dx);
        cancelOffsetX.setValue(offsetX);

        const wasInCancelZone = isDraggingToCancel.current;
        const isInCancelZone = Math.abs(offsetX) > CANCEL_DISTANCE;

        // Haptic when entering cancel zone
        if (isInCancelZone && !wasInCancelZone) {
          Vibration.vibrate(30);
        }

        isDraggingToCancel.current = isInCancelZone;
      },
      onPanResponderRelease: () => {
        console.log('[VoiceButton] Press released, cancel:', isDraggingToCancel.current);
        // Haptic on release
        Vibration.vibrate(30);

        if (isDraggingToCancel.current) {
          callbacksRef.current.onCancelRecording();
        } else {
          callbacksRef.current.onStopRecording();
        }
        Animated.spring(cancelOffsetX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
        isDraggingToCancel.current = false;
      },
      onPanResponderTerminate: () => {
        console.log('[VoiceButton] Press terminated');
        callbacksRef.current.onCancelRecording();
        Animated.spring(cancelOffsetX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
        isDraggingToCancel.current = false;
      },
    })
  ).current;

  const handleUnavailableTap = () => {
    const errorDetail = error || 'No transcription model downloaded';
    Alert.alert(
      'Voice Input Unavailable',
      `${errorDetail}\n\nTo enable voice input:\n1. Go to Settings tab\n2. Scroll to "Voice Transcription"\n3. Download a Whisper model\n\nVoice transcription runs completely on-device for privacy.`,
      [{ text: 'OK' }]
    );
  };

  // Show unavailable state instead of hiding
  if (!isAvailable) {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.buttonWrapper}
          onPress={handleUnavailableTap}
        >
          <View style={[styles.button, styles.buttonUnavailable]}>
            <View style={styles.micIcon}>
              <View style={[styles.micBody, styles.micBodyUnavailable]} />
              <View style={[styles.micBase, styles.micBodyUnavailable]} />
            </View>
            <View style={styles.unavailableSlash} />
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Cancel hint */}
      {isRecording && (
        <Animated.View
          style={[
            styles.cancelHint,
            {
              opacity: cancelOffsetX.interpolate({
                inputRange: [-CANCEL_DISTANCE, 0],
                outputRange: [1, 0],
                extrapolate: 'clamp',
              }),
            },
          ]}
        >
          <Text style={styles.cancelHintText}>Slide to cancel</Text>
        </Animated.View>
      )}

      {/* Partial result display */}
      {isRecording && partialResult && (
        <View style={styles.partialResultContainer}>
          <Text style={styles.partialResultText} numberOfLines={1}>
            {partialResult}
          </Text>
        </View>
      )}

      {/* Main button with pan responder for hold-to-record */}
      <Animated.View
        style={[
          styles.buttonWrapper,
          {
            transform: [
              { scale: isRecording ? pulseAnim : 1 },
              { translateX: cancelOffsetX },
            ],
          },
        ]}
        {...(disabled ? {} : panResponder.panHandlers)}
      >
        <View
          style={[
            styles.button,
            isRecording && styles.buttonRecording,
            disabled && styles.buttonDisabled,
          ]}
        >
          <View style={styles.micIcon}>
            <View style={[styles.micBody, isRecording && styles.micBodyRecording]} />
            <View style={[styles.micBase, isRecording && styles.micBodyRecording]} />
          </View>
        </View>
      </Animated.View>

      {/* Explicit cancel button when recording */}
      {isRecording && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onCancelRecording}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonWrapper: {
    marginRight: 4,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRecording: {
    backgroundColor: COLORS.error,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonUnavailable: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  micIcon: {
    alignItems: 'center',
  },
  micBody: {
    width: 8,
    height: 12,
    backgroundColor: COLORS.textSecondary,
    borderRadius: 4,
  },
  micBodyRecording: {
    backgroundColor: COLORS.text,
  },
  micBodyUnavailable: {
    backgroundColor: COLORS.textMuted,
  },
  micBase: {
    width: 12,
    height: 3,
    backgroundColor: COLORS.textSecondary,
    borderRadius: 1.5,
    marginTop: 2,
  },
  unavailableSlash: {
    position: 'absolute',
    width: 24,
    height: 2,
    backgroundColor: COLORS.textMuted,
    transform: [{ rotate: '-45deg' }],
  },
  cancelHint: {
    position: 'absolute',
    left: -100,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.error + '40',
    borderRadius: 12,
  },
  cancelHintText: {
    color: COLORS.error,
    fontSize: 12,
    fontWeight: '500',
  },
  cancelButton: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  cancelButtonText: {
    color: COLORS.error,
    fontSize: 12,
    fontWeight: '500',
  },
  partialResultContainer: {
    position: 'absolute',
    right: 50,
    maxWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
  },
  partialResultText: {
    color: COLORS.text,
    fontSize: 12,
  },
});
