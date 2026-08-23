import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { useTheme } from '../theme';

interface LoadingDotsProps {
  /** Dot colour. Defaults to the accent, which is what a surface uses on its own background. */
  color?: string;
  /** Diameter in points. The dots stay circular at any size. */
  size?: number;
  style?: ViewStyle;
  testID?: string;
}

/**
 * The three-dot busy animation - the ONE loader in this app. It exists as its own component
 * because it had two homes: the animation inside ThinkingIndicator, and a platform
 * ActivityIndicator inside Button. A ring spinner on a button reads as a retry glyph, not as
 * work in progress, so a paired device and a shared file both looked like they had failed.
 * Every busy state renders this, and the animation is defined once.
 */
export const LoadingDots: React.FC<LoadingDotsProps> = ({
  color,
  size = 6,
  style,
  testID,
}) => {
  const { colors } = useTheme();
  const dot1Anim = useRef(new Animated.Value(0.3)).current;
  const dot2Anim = useRef(new Animated.Value(0.3)).current;
  const dot3Anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const duration = 400;
    // Each dot runs the same fade, offset by 150ms, so the brightness travels left to right.
    const loops = [dot1Anim, dot2Anim, dot3Anim].map((anim, i) =>
      Animated.sequence([
        Animated.delay(i * 150),
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 1,
              duration,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0.3,
              duration,
              useNativeDriver: true,
            }),
          ]),
        ),
      ]),
    );
    loops.forEach(loop => loop.start());

    return () => loops.forEach(loop => loop.stop());
  }, [dot1Anim, dot2Anim, dot3Anim]);

  const dotStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color ?? colors.primary,
  };

  return (
    <View
      style={[styles.dots, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Working"
    >
      <Animated.View style={[styles.dot, dotStyle, { opacity: dot1Anim }]} />
      <Animated.View style={[styles.dot, dotStyle, { opacity: dot2Anim }]} />
      <Animated.View style={[styles.dot, dotStyle, { opacity: dot3Anim }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    // The dots are a fixed width. Without this they give up width to a sibling label on a
    // narrow screen and the animation collapses.
    flexShrink: 0,
  },
  dot: {
    marginHorizontal: 2,
  },
});
