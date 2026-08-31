import React, { useState, type ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { SPACING, TYPOGRAPHY } from '../constants';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

interface AccordionProps {
  /** Rendered as an uppercase label whisper, so pass it in sentence case. */
  title: string;
  /** Rendered beside the chevron: the one fact worth seeing while the section is closed. */
  right?: ReactNode;
  defaultOpen?: boolean;
  /** Use plain when the disclosure already sits inside another card. */
  variant?: 'card' | 'plain';
  testID?: string;
  children: ReactNode;
}

/**
 * A titled card that opens and closes.
 *
 * The same shape Model Settings uses - an uppercase title, a chevron, and the content below it - but
 * as one component rather than a header row hand-rolled per screen. A long settings page is easier to
 * read as a handful of closed sections than as everything at once, and the sections that matter to a
 * given user are the ones they open.
 *
 * Open state is local: it belongs to this view of this screen and is not worth persisting.
 */
export const Accordion: React.FC<AccordionProps> = ({
  title,
  right,
  defaultOpen = false,
  variant = 'card',
  testID,
  children,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={[styles.card, variant === 'plain' && styles.plainCard]}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        onPress={() => setOpen(current => !current)}
        testID={testID}
      >
        <Text style={styles.title}>{title}</Text>
        {right}
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {open ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  card: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 12,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  plainCard: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    boxShadow: 'none',
  },
  header: {
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    flex: 1,
  },
  content: {
    paddingBottom: SPACING.sm,
  },
});
