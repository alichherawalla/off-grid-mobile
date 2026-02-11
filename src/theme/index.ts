import { useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  COLORS_LIGHT,
  COLORS_DARK,
  SHADOWS_LIGHT,
  SHADOWS_DARK,
  createElevation,
} from './palettes';
import type { ThemeColors, ThemeShadows } from './palettes';

export type { ThemeColors, ThemeShadows };
export { useThemedStyles } from './useThemedStyles';

export type ThemeMode = 'light' | 'dark';

export interface Theme {
  colors: typeof COLORS_LIGHT;
  shadows: ThemeShadows;
  elevation: ReturnType<typeof createElevation>;
  isDark: boolean;
}

/** Get theme for a given mode (non-hook, for use outside components) */
export function getTheme(mode: ThemeMode): Theme {
  const isDark = mode === 'dark';
  const colors = isDark ? COLORS_DARK : COLORS_LIGHT;
  const shadows = isDark ? SHADOWS_DARK : SHADOWS_LIGHT;
  const elevation = createElevation(colors);
  return { colors, shadows, elevation, isDark };
}

/** Hook that returns the current theme based on appStore themeMode */
export function useTheme(): Theme {
  const themeMode = useAppStore((s) => s.themeMode);
  return useMemo(() => getTheme(themeMode), [themeMode]);
}
