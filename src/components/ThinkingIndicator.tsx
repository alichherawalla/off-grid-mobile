import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../constants';

interface ThinkingIndicatorProps {
  text?: string;
  textStyle?: any;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  text = 'Thinking...',
  textStyle
}) => {
  const dot1Anim = useRef(new Animated.Value(0.3)).current;
  const dot2Anim = useRef(new Animated.Value(0.3)).current;
  const dot3Anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const duration = 400;
    const sequence = Animated.loop(
      Animated.sequence([
        Animated.timing(dot1Anim, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(dot1Anim, { toValue: 0.3, duration, useNativeDriver: true }),
      ])
    );
    const sequence2 = Animated.loop(
      Animated.sequence([
        Animated.delay(150),
        Animated.timing(dot2Anim, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(dot2Anim, { toValue: 0.3, duration, useNativeDriver: true }),
      ])
    );
    const sequence3 = Animated.loop(
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(dot3Anim, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(dot3Anim, { toValue: 0.3, duration, useNativeDriver: true }),
      ])
    );
    sequence.start();
    sequence2.start();
    sequence3.start();

    return () => {
      sequence.stop();
      sequence2.stop();
      sequence3.stop();
    };
  }, []);

  return (
    <View style={styles.thinkingContainer}>
      <View style={styles.thinkingDots}>
        <Animated.View style={[styles.thinkingDot, { opacity: dot1Anim }]} />
        <Animated.View style={[styles.thinkingDot, { opacity: dot2Anim }]} />
        <Animated.View style={[styles.thinkingDot, { opacity: dot3Anim }]} />
      </View>
      <Text style={[styles.thinkingText, textStyle]}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thinkingDots: {
    flexDirection: 'row',
    marginRight: 8,
  },
  thinkingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
    marginHorizontal: 2,
  },
  thinkingText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
  },
});
