import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Dimensions,
  Animated,
} from 'react-native';
import ReanimatedAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { ONBOARDING_SLIDES, SPACING, TYPOGRAPHY } from '../constants';
import { useAppStore } from '../stores';
import { RootStackParamList } from '../navigation/types';

type OnboardingScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;
};

const { width } = Dimensions.get('window');

/** Animated slide with staggered entrance for icon, title, description */
const SlideContent: React.FC<{
  item: typeof ONBOARDING_SLIDES[0];
  isActive: boolean;
  styles: ReturnType<typeof createStyles>;
  primaryColor: string;
}> = ({
  item,
  isActive,
  styles,
  primaryColor,
}) => {
  const iconScale = useSharedValue(0.6);
  const iconOpacity = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(16);
  const descOpacity = useSharedValue(0);
  const descTranslateY = useSharedValue(16);

  useEffect(() => {
    if (isActive) {
      // Reset
      iconScale.value = 0.6;
      iconOpacity.value = 0;
      titleOpacity.value = 0;
      titleTranslateY.value = 16;
      descOpacity.value = 0;
      descTranslateY.value = 16;

      // Stagger in
      iconScale.value = withSpring(1, { damping: 12, stiffness: 150 });
      iconOpacity.value = withTiming(1, { duration: 300 });
      titleOpacity.value = withDelay(150, withTiming(1, { duration: 300 }));
      titleTranslateY.value = withDelay(150, withTiming(0, { duration: 300 }));
      descOpacity.value = withDelay(300, withTiming(1, { duration: 300 }));
      descTranslateY.value = withDelay(300, withTiming(0, { duration: 300 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const iconStyle = useAnimatedStyle(() => ({
    opacity: iconOpacity.value,
    transform: [{ scale: iconScale.value }],
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));

  const descStyle = useAnimatedStyle(() => ({
    opacity: descOpacity.value,
    transform: [{ translateY: descTranslateY.value }],
  }));

  return (
    <View style={styles.slide}>
      <ReanimatedAnimated.View style={[styles.iconContainer, iconStyle]}>
        <Icon name={item.icon} size={64} color={primaryColor} />
      </ReanimatedAnimated.View>
      <ReanimatedAnimated.View style={titleStyle}>
        <Text style={styles.title}>{item.title}</Text>
      </ReanimatedAnimated.View>
      <ReanimatedAnimated.View style={descStyle}>
        <Text style={styles.description}>{item.description}</Text>
      </ReanimatedAnimated.View>
    </View>
  );
};

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  navigation,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const handleNext = () => {
    if (currentIndex < ONBOARDING_SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    } else {
      completeOnboarding();
    }
  };

  const handleSkip = () => {
    completeOnboarding();
  };

  const completeOnboarding = () => {
    setOnboardingComplete(true);
    navigation.replace('ModelDownload');
  };

  const renderSlide = ({ item, index }: { item: typeof ONBOARDING_SLIDES[0]; index: number }) => (
    <SlideContent item={item} isActive={currentIndex === index} styles={styles} primaryColor={colors.primary} />
  );

  const renderDots = () => (
    <View style={styles.dotsContainer}>
      {ONBOARDING_SLIDES.map((_, index) => {
        const inputRange = [
          (index - 1) * width,
          index * width,
          (index + 1) * width,
        ];

        const dotWidth = scrollX.interpolate({
          inputRange,
          outputRange: [8, 24, 8],
          extrapolate: 'clamp',
        });

        const opacity = scrollX.interpolate({
          inputRange,
          outputRange: [0.3, 1, 0.3],
          extrapolate: 'clamp',
        });

        return (
          <Animated.View
            key={index}
            style={[styles.dot, { width: dotWidth, opacity }]}
          />
        );
      })}
    </View>
  );

  const isLastSlide = currentIndex === ONBOARDING_SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <View testID="onboarding-screen" style={{flex: 1}}>
      <View style={styles.header}>
        {!isLastSlide && (
          <Button
            title="Skip"
            variant="ghost"
            onPress={handleSkip}
            testID="onboarding-skip"
          />
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={ONBOARDING_SLIDES}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentIndex(index);
        }}
      />

      {renderDots()}

      <View style={styles.footer}>
        <Button
          title={isLastSlide ? 'Get Started' : 'Next'}
          onPress={handleNext}
          size="large"
          style={styles.nextButton}
          testID="onboarding-next"
        />
      </View>
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    minHeight: 48,
  },
  slide: {
    width,
    paddingHorizontal: SPACING.xxl,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.xxl,
    ...shadows.medium,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
    textAlign: 'center' as const,
    marginBottom: SPACING.md,
  },
  description: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  dotsContainer: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginVertical: SPACING.xl,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginHorizontal: SPACING.xs,
  },
  footer: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  nextButton: {
    width: '100%' as const,
  },
});
