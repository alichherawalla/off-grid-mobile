// Light and dark color palettes + shadow definitions

export type ThemeColors = typeof COLORS_LIGHT;

interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export type ThemeShadows = {
  small: ShadowStyle;
  medium: ShadowStyle;
  large: ShadowStyle;
  glow: ShadowStyle;
};

// ── Light palette ──────────────────────────────────────────────────
export const COLORS_LIGHT = {
  // Primary accent
  primary: '#059669',
  primaryDark: '#047857',
  primaryLight: '#34D399',

  // Backgrounds
  background: '#FFFFFF',
  surface: '#F5F5F5',
  surfaceLight: '#EBEBEB',
  surfaceHover: '#E0E0E0',

  // Text hierarchy
  text: '#0A0A0A',
  textSecondary: '#525252',
  textMuted: '#8A8A8A',
  textDisabled: '#BFBFBF',

  // Borders
  border: '#E5E5E5',
  borderLight: '#D4D4D4',
  borderFocus: '#059669',

  // Semantic colors
  success: '#525252',
  warning: '#0A0A0A',
  error: '#DC2626',
  info: '#525252',

  // Special
  overlay: 'rgba(0, 0, 0, 0.4)',
  divider: '#EBEBEB',
};

// ── Dark palette ───────────────────────────────────────────────────
export const COLORS_DARK = {
  // Primary accent
  primary: '#34D399',
  primaryDark: '#10B981',
  primaryLight: '#6EE7B7',

  // Backgrounds
  background: '#0A0A0A',
  surface: '#141414',
  surfaceLight: '#1E1E1E',
  surfaceHover: '#252525',

  // Text hierarchy
  text: '#FFFFFF',
  textSecondary: '#B0B0B0',
  textMuted: '#808080',
  textDisabled: '#4A4A4A',

  // Borders
  border: '#1E1E1E',
  borderLight: '#2A2A2A',
  borderFocus: '#34D399',

  // Semantic colors
  success: '#B0B0B0',
  warning: '#FFFFFF',
  error: '#EF4444',
  info: '#B0B0B0',

  // Special
  overlay: 'rgba(0, 0, 0, 0.7)',
  divider: '#1A1A1A',
};

// ── Light shadows (standard black shadows) ──────────────────────────
export const SHADOWS_LIGHT = {
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 6,
  },
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 12,
  },
  glow: {
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
} as const;

// ── Dark shadows (tight crisp glow — no soft halos) ───
export const SHADOWS_DARK = {
  small: {
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 1,
    elevation: 3,
  },
  medium: {
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.10,
    shadowRadius: 2,
    elevation: 6,
  },
  large: {
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 12,
  },
  glow: {
    shadowColor: '#34D399',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
} as const;

// ── Elevation factory ──────────────────────────────────────────────
export function createElevation(colors: ThemeColors) {
  return {
    level0: {
      backgroundColor: colors.background,
      borderWidth: 0,
      borderColor: 'transparent',
    },
    level1: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    level2: {
      backgroundColor: colors.surfaceLight,
      borderWidth: 1,
      borderColor: colors.borderLight,
    },
    level3: {
      backgroundColor: `${colors.surface}F2`,
      borderTopWidth: 1,
      borderColor: colors.borderLight,
      borderRadius: 16,
      blur: {
        ios: { blurAmount: 10, blurType: colors.background === '#0A0A0A' ? 'dark' : 'light' },
        android: { overlayColor: colors.overlay },
      },
    },
    level4: {
      backgroundColor: `${colors.surface}FA`,
      borderTopWidth: 1,
      borderColor: colors.primary,
      borderRadius: 16,
      blur: {
        ios: { blurAmount: 15, blurType: colors.background === '#0A0A0A' ? 'dark' : 'light' },
        android: { overlayColor: colors.overlay },
      },
    },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: colors.textMuted,
      borderRadius: 2,
      alignSelf: 'center' as const,
    },
  } as const;
}
