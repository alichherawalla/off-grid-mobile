import type React from 'react';
import {
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
  Vibration,
} from 'react-native';
import logger from '../../utils/logger';

const CANCEL_DISTANCE = 80;
const LONG_PRESS_DURATION_MS = 350;
const HOLD_GESTURE_DISTANCE = 12;

export type VoiceRecordInteractionMode = 'idle' | 'holding' | 'locked';

export interface VoiceRecordCallbacks {
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  onInteractionModeChange?: (mode: VoiceRecordInteractionMode) => void;
}

interface BuildVoiceRecordGestureInput {
  isDraggingToCancel: React.MutableRefObject<boolean>;
  cancelOffsetX: Animated.Value;
  callbacksRef: React.MutableRefObject<VoiceRecordCallbacks>;
  recordingRef: React.MutableRefObject<boolean>;
  tapLockedRef: React.MutableRefObject<boolean>;
  tapLockObservedRecordingRef: React.MutableRefObject<boolean>;
  longPressTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setTapLocked: (locked: boolean) => void;
}

/**
 * One gesture owner for tap-to-lock, hold-to-record, and slide-to-cancel.
 * The returned responder stays mounted while model loading changes the button face.
 */
export function buildVoiceRecordGesture({
  isDraggingToCancel,
  cancelOffsetX,
  callbacksRef,
  recordingRef,
  tapLockedRef,
  tapLockObservedRecordingRef,
  longPressTimerRef,
  setTapLocked,
}: BuildVoiceRecordGestureInput) {
  let pressStartedAt = 0;
  let pressStartedWhileActive = false;

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const resetPosition = () => {
    Animated.spring(cancelOffsetX, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
    isDraggingToCancel.current = false;
  };

  const unlock = () => {
    tapLockedRef.current = false;
    tapLockObservedRecordingRef.current = false;
    setTapLocked(false);
    callbacksRef.current.onInteractionModeChange?.('idle');
  };

  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event: GestureResponderEvent) => {
      logger.log('[VoiceButton] Press started');
      Vibration.vibrate(50);
      clearLongPressTimer();
      // Use the native touch clock. Model or microphone startup can block the JS
      // thread, so Date.now() at handler execution can turn a short physical tap
      // into an apparent long press when the queued release arrives late.
      pressStartedAt = event.nativeEvent.timestamp;
      isDraggingToCancel.current = false;
      pressStartedWhileActive = recordingRef.current || tapLockedRef.current;
      if (!pressStartedWhileActive) {
        callbacksRef.current.onInteractionModeChange?.('idle');
        callbacksRef.current.onStartRecording();
        longPressTimerRef.current = setTimeout(() => {
          callbacksRef.current.onInteractionModeChange?.('holding');
          longPressTimerRef.current = null;
        }, LONG_PRESS_DURATION_MS);
      }
    },
    onPanResponderMove: (
      _: GestureResponderEvent,
      gestureState: PanResponderGestureState,
    ) => {
      if (
        !pressStartedWhileActive &&
        Math.hypot(gestureState.dx, gestureState.dy) >= HOLD_GESTURE_DISTANCE
      ) {
        clearLongPressTimer();
        callbacksRef.current.onInteractionModeChange?.('holding');
      }
      const offsetX = Math.min(0, gestureState.dx);
      cancelOffsetX.setValue(offsetX);
      const wasInCancelZone = isDraggingToCancel.current;
      const isInCancelZone = Math.abs(offsetX) > CANCEL_DISTANCE;
      if (isInCancelZone && !wasInCancelZone) Vibration.vibrate(30);
      isDraggingToCancel.current = isInCancelZone;
    },
    onPanResponderRelease: (event: GestureResponderEvent) => {
      logger.log(
        '[VoiceButton] Press released, cancel:',
        isDraggingToCancel.current,
      );
      Vibration.vibrate(30);
      clearLongPressTimer();
      const pressDuration = event.nativeEvent.timestamp - pressStartedAt;
      if (isDraggingToCancel.current) {
        callbacksRef.current.onCancelRecording();
        unlock();
      } else if (
        pressStartedWhileActive ||
        pressDuration >= LONG_PRESS_DURATION_MS
      ) {
        callbacksRef.current.onStopRecording();
        unlock();
      } else {
        tapLockedRef.current = true;
        tapLockObservedRecordingRef.current = recordingRef.current;
        setTapLocked(true);
        // The tap intent stays locked across a cold model load. The composer shows
        // its loading status first, then reveals "Tap mic to stop" as soon as
        // capture becomes active.
        callbacksRef.current.onInteractionModeChange?.('locked');
      }
      resetPosition();
    },
    onPanResponderTerminate: () => {
      logger.log('[VoiceButton] Press terminated');
      clearLongPressTimer();
      callbacksRef.current.onCancelRecording();
      unlock();
      resetPosition();
    },
  });
}
