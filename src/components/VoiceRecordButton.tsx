import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  Vibration,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from './CustomAlert';

interface VoiceRecordButtonProps {
  isRecording: boolean;
  isAvailable: boolean;
  isModelLoading?: boolean;
  isTranscribing?: boolean;
  partialResult: string;
  error?: string | null;
  disabled?: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  /** Style as send button (WhatsApp-style, replaces send when input empty) */
  asSendButton?: boolean;
}

const CANCEL_DISTANCE = 80;

export const VoiceRecordButton: React.FC<VoiceRecordButtonProps> = ({
  isRecording,
  isAvailable,
  isModelLoading,
  isTranscribing,
  partialResult,
  error,
  disabled,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  asSendButton = false,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const loadingAnim = useRef(new Animated.Value(0)).current;
  const cancelOffsetX = useRef(new Animated.Value(0)).current;
  const isDraggingToCancel = useRef(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  // Loading animation for model loading or transcribing
  useEffect(() => {
    if (isModelLoading || (isTranscribing && !isRecording)) {
      const spin = Animated.loop(
        Animated.timing(loadingAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      );
      spin.start();
      return () => spin.stop();
    } else {
      loadingAnim.setValue(0);
    }
  }, [isModelLoading, isTranscribing, isRecording, loadingAnim]);

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
    setAlertState(showAlert(
      'Voice Input Unavailable',
      `${errorDetail}\n\nTo enable voice input:\n1. Go to Settings tab\n2. Scroll to "Voice Transcription"\n3. Download a Whisper model\n\nVoice transcription runs completely on-device for privacy.`,
      [{ text: 'OK' }]
    ));
  };

  // Show loading state when model is loading
  if (isModelLoading) {
    const spin = loadingAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });

    return (
      <View style={styles.container}>
        <View style={asSendButton ? undefined : styles.loadingContainer}>
          <Animated.View
            style={[
              styles.button,
              asSendButton ? styles.buttonAsSendLoading : styles.buttonLoading,
              { transform: [{ rotate: spin }] },
            ]}
          >
            {asSendButton ? (
              <Icon name="mic" size={18} color={COLORS.primary} />
            ) : (
              <View style={styles.loadingIndicator} />
            )}
          </Animated.View>
          {!asSendButton && <Text style={styles.loadingText}>Loading...</Text>}
        </View>
        <CustomAlert
          visible={alertState.visible}
          title={alertState.title}
          message={alertState.message}
          buttons={alertState.buttons}
          onClose={() => setAlertState(hideAlert())}
        />
      </View>
    );
  }

  // Show transcribing state (after recording stopped, processing audio)
  if (isTranscribing && !isRecording) {
    const spin = loadingAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });

    return (
      <View style={styles.container}>
        <View style={asSendButton ? undefined : styles.loadingContainer}>
          <Animated.View
            style={[
              styles.button,
              asSendButton ? styles.buttonAsSendLoading : styles.buttonTranscribing,
              { transform: [{ rotate: spin }] },
            ]}
          >
            {asSendButton ? (
              <Icon name="mic" size={18} color={COLORS.info} />
            ) : (
              <View style={styles.loadingIndicator} />
            )}
          </Animated.View>
          {!asSendButton && <Text style={styles.transcribingText}>Transcribing...</Text>}
        </View>
        <CustomAlert
          visible={alertState.visible}
          title={alertState.title}
          message={alertState.message}
          buttons={alertState.buttons}
          onClose={() => setAlertState(hideAlert())}
        />
      </View>
    );
  }

  // Show unavailable state instead of hiding
  if (!isAvailable) {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.buttonWrapper}
          onPress={handleUnavailableTap}
        >
          <View style={[styles.button, asSendButton && styles.buttonAsSendUnavailable, !asSendButton && styles.buttonUnavailable]}>
            {asSendButton ? (
              <Icon name="mic-off" size={18} color={COLORS.textMuted} />
            ) : (
              <>
                <View style={styles.micIcon}>
                  <View style={[styles.micBody, styles.micBodyUnavailable]} />
                  <View style={[styles.micBase, styles.micBodyUnavailable]} />
                </View>
                <View style={styles.unavailableSlash} />
              </>
            )}
          </View>
        </TouchableOpacity>
        <CustomAlert
          visible={alertState.visible}
          title={alertState.title}
          message={alertState.message}
          buttons={alertState.buttons}
          onClose={() => setAlertState(hideAlert())}
        />
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
            asSendButton && styles.buttonAsSend,
            isRecording && styles.buttonRecording,
            disabled && styles.buttonDisabled,
          ]}
        >
          {/* Show send icon by default when asSendButton, mic when recording */}
          {asSendButton && !isRecording ? (
            <Icon name="send" size={18} color={COLORS.primary} />
          ) : asSendButton && isRecording ? (
            <Icon name="mic" size={18} color={COLORS.primary} />
          ) : (
            <View style={styles.micIcon}>
              <View style={[
                styles.micBody,
                isRecording && styles.micBodyRecording,
              ]} />
              <View style={[
                styles.micBase,
                isRecording && styles.micBodyRecording,
              ]} />
            </View>
          )}
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
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonWrapper: {
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonAsSend: {
    width: 44,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  buttonAsSendUnavailable: {
    width: 44,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surfaceLight,
  },
  buttonAsSendLoading: {
    width: 44,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderTopColor: 'transparent',
  },
  buttonRecording: {
    backgroundColor: COLORS.error,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLoading: {
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderTopColor: 'transparent',
  },
  buttonTranscribing: {
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.info,
    borderTopColor: 'transparent',
  },
  buttonUnavailable: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  loadingText: {
    fontSize: 11,
    color: COLORS.primary,
    marginLeft: 6,
  },
  transcribingText: {
    fontSize: 11,
    color: COLORS.info,
    marginLeft: 6,
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
  micBodyAsSend: {
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
