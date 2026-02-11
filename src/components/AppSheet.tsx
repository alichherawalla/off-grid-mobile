import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Animated,
  PanResponder,
  Dimensions,
  Platform,
} from 'react-native';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface AppSheetProps {
  visible: boolean;
  onClose: () => void;
  snapPoints?: (string | number)[];
  enableDynamicSizing?: boolean;
  title?: string;
  closeLabel?: string;
  showHeader?: boolean;
  showHandle?: boolean;
  elevation?: 'level3' | 'level4';
  children: React.ReactNode;
}

function resolveSnapPoint(snap: string | number): number {
  if (typeof snap === 'number') return snap;
  if (typeof snap === 'string' && snap.endsWith('%')) {
    return (parseFloat(snap) / 100) * SCREEN_HEIGHT;
  }
  return SCREEN_HEIGHT * 0.5;
}

export const AppSheet: React.FC<AppSheetProps> = ({
  visible,
  onClose,
  snapPoints,
  enableDynamicSizing = false,
  title,
  closeLabel = 'Done',
  showHeader = true,
  showHandle = true,
  elevation = 'level3',
  children,
}) => {
  const { colors, elevation: elevationTokens } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [modalVisible, setModalVisible] = useState(false);
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Keep onClose ref current for PanResponder
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Calculate sheet max height from largest snap point
  const sheetMaxHeight = enableDynamicSizing
    ? SCREEN_HEIGHT * 0.85
    : resolveSnapPoint(
        snapPoints?.[snapPoints.length - 1] || '50%',
      );

  const levelTokens = elevationTokens[elevation];

  // Animate in
  const animateIn = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        damping: 28,
        stiffness: 300,
        mass: 0.8,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: Platform.OS === 'ios' ? 0.6 : 0.7,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, backdropOpacity]);

  // Animate out then callback
  const animateOut = useCallback(
    (cb?: () => void) => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => cb?.());
    },
    [translateY, backdropOpacity],
  );

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      // Small delay so Modal mounts before we animate
      const timer = setTimeout(animateIn, 16);
      return () => clearTimeout(timer);
    } else if (modalVisible) {
      animateOut(() => setModalVisible(false));
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // User-initiated dismiss (backdrop tap, Done button, swipe)
  const dismiss = useCallback(() => {
    animateOut(() => {
      setModalVisible(false);
      onCloseRef.current();
    });
  }, [animateOut]);

  // Swipe-to-dismiss on handle
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 8,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) {
          translateY.setValue(dy);
        }
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 0.5) {
          // Dismiss
          Animated.parallel([
            Animated.timing(translateY, {
              toValue: SCREEN_HEIGHT,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
              toValue: 0,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start(() => {
            setModalVisible(false);
            onCloseRef.current();
          });
        } else {
          // Snap back
          Animated.spring(translateY, {
            toValue: 0,
            damping: 28,
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  if (!modalVisible && !visible) {
    return null;
  }

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* Backdrop */}
        <TouchableWithoutFeedback onPress={dismiss}>
          <Animated.View
            style={[styles.backdrop, { opacity: backdropOpacity }]}
          />
        </TouchableWithoutFeedback>

        {/* Sheet */}
        <Animated.View
          style={[
            styles.sheet,
            {
              ...(enableDynamicSizing
                ? { maxHeight: SCREEN_HEIGHT * 0.85 }
                : { height: sheetMaxHeight }),
              backgroundColor: levelTokens.backgroundColor,
              borderTopLeftRadius: levelTokens.borderRadius,
              borderTopRightRadius: levelTokens.borderRadius,
              borderTopWidth: levelTokens.borderTopWidth,
              borderColor: levelTokens.borderColor,
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Handle — swipe target */}
          {showHandle && (
            <View {...panResponder.panHandlers} style={styles.handleContainer}>
              <View
                style={[
                  styles.handle,
                  {
                    width: elevationTokens.handle.width,
                    height: elevationTokens.handle.height,
                    backgroundColor: elevationTokens.handle.backgroundColor,
                    borderRadius: elevationTokens.handle.borderRadius,
                  },
                ]}
              />
            </View>
          )}

          {/* Header */}
          {showHeader && title ? (
            <View style={styles.header}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {title}
              </Text>
              <TouchableOpacity
                onPress={dismiss}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.headerClose}>{closeLabel}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Content */}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    justifyContent: 'flex-end' as const,
  },
  backdrop: {
    ...({
      position: 'absolute' as const,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    }),
    backgroundColor: '#000000',
  },
  sheet: {
    overflow: 'hidden' as const,
    ...shadows.large,
  },
  handleContainer: {
    alignItems: 'center' as const,
    paddingVertical: SPACING.sm,
  },
  handle: {},
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    flex: 1,
    marginRight: SPACING.md,
  },
  headerClose: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
});
