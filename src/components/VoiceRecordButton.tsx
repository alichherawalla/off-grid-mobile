import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  Vibration,
} from 'react-native';
import ReanimatedAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
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
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const loadingAnim = useRef(new Animated.Value(0)).current;
  const cancelOffsetX = useRef(new Animated.Value(0)).current;
  const isDraggingToCancel = useRef(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  // Reanimated ripple ring
  const rippleScale = useSharedValue(1);
  const rippleOpacity = useSharedValue(0);

  useEffect(() => {
    if (isRecording) {
      rippleScale.value = 1;
      rippleOpacity.value = 0.4;
      rippleScale.value = withRepeat(
        withTiming(2.2, { duration: 1200, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
      rippleOpacity.value = withRepeat(
        withTiming(0, { duration: 1200, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
    } else {
      rippleScale.value = 1;
      rippleOpacity.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rippleScale.value }],
    opacity: rippleOpacity.value,
  }));

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
              <Icon name="mic" size={18} color={colors.primary} />
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
              <Icon name="mic" size={18} color={colors.info} />
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
              <Icon name="mic-off" size={18} color={colors.textMuted} />
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

      {/* Ripple ring behind button when recording */}
      {isRecording && (
        <ReanimatedAnimated.View style={[styles.rippleRing, rippleStyle]} />
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
            <Icon name="send" size={18} color={colors.primary} />
          ) : asSendButton && isRecording ? (
            <Icon name="mic" size={18} color={colors.primary} />
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

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rippleRing: {
    position: 'absolute' as const,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.error,
    backgroundColor: 'transparent',
  },
  buttonWrapper: {
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  buttonAsSend: {
    width: 44,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  buttonAsSendUnavailable: {
    width: 44,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceLight,
  },
  buttonAsSendLoading: {
    width: 44,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderTopColor: 'transparent',
  },
  buttonRecording: {
    backgroundColor: colors.error,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLoading: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderTopColor: 'transparent',
  },
  buttonTranscribing: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.info,
    borderTopColor: 'transparent',
  },
  buttonUnavailable: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed' as const,
  },
  loadingContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  loadingIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  loadingText: {
    fontSize: 11,
    color: colors.primary,
    marginLeft: 6,
  },
  transcribingText: {
    fontSize: 11,
    color: colors.info,
    marginLeft: 6,
  },
  micIcon: {
    alignItems: 'center' as const,
  },
  micBody: {
    width: 8,
    height: 12,
    backgroundColor: colors.textSecondary,
    borderRadius: 4,
  },
  micBodyRecording: {
    backgroundColor: colors.text,
  },
  micBodyAsSend: {
    backgroundColor: colors.text,
  },
  micBodyUnavailable: {
    backgroundColor: colors.textMuted,
  },
  micBase: {
    width: 12,
    height: 3,
    backgroundColor: colors.textSecondary,
    borderRadius: 1.5,
    marginTop: 2,
  },
  unavailableSlash: {
    position: 'absolute' as const,
    width: 24,
    height: 2,
    backgroundColor: colors.textMuted,
    transform: [{ rotate: '-45deg' }],
  },
  cancelHint: {
    position: 'absolute' as const,
    left: -100,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.error + '40',
    borderRadius: 12,
  },
  cancelHintText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  cancelButton: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
  },
  cancelButtonText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  partialResultContainer: {
    position: 'absolute' as const,
    right: 50,
    maxWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  partialResultText: {
    color: colors.text,
    fontSize: 12,
  },
});
