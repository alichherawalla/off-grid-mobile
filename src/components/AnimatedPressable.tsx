import React, { useCallback } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';
import { triggerHaptic, type HapticType } from '../utils/haptics';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

export interface AnimatedPressableProps extends PressableProps {
  scaleValue?: number;
  hapticType?: HapticType;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function AnimatedPressable({
  scaleValue = 0.97,
  hapticType,
  disabled = false,
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (e: any) => {
      if (!disabled && !reducedMotion) {
        scale.value = withSpring(scaleValue, { damping: 15, stiffness: 400 });
      }
      if (hapticType) {
        triggerHaptic(hapticType);
      }
      onPressIn?.(e);
    },
    [disabled, reducedMotion, scaleValue, hapticType, onPressIn, scale],
  );

  const handlePressOut = useCallback(
    (e: any) => {
      if (!disabled && !reducedMotion) {
        scale.value = withSpring(1, { damping: 10, stiffness: 400 });
      }
      onPressOut?.(e);
    },
    [disabled, reducedMotion, onPressOut, scale],
  );

  return (
    <AnimatedPressableBase
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, { opacity: disabled ? 0.4 : 1, overflow: 'visible' as const }, style]}
    >
      {children}
    </AnimatedPressableBase>
  );
}
