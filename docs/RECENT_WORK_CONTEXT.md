# Recent Work Context — Design System Overhaul

## Summary

Implemented a comprehensive **brutalist design system** for LocalLLM, transforming the UI from a colorful, rounded interface to a minimal, monochromatic terminal-inspired aesthetic with emerald green as the sole accent color.

---

## What Was Done

### 1. **Design Tokens Created** (`src/constants/index.ts`)

Added centralized design tokens to ensure consistency:

- **Typography Scale:** 10 text styles (display, h1-h3, body, label, meta) all using Menlo monospace
- **Spacing Scale:** 6-step scale (xs: 4px → xxl: 32px) for all padding/margins
- **Color Palette:** Monochromatic blacks/grays with emerald green (`#34D399`) accent
  - Backgrounds: Pure black (`#0A0A0A`) → surface → surfaceLight
  - Text hierarchy: White → secondary gray → muted gray → disabled
  - Single accent: Emerald green for active/focus states only

### 2. **Components Refactored** (20 files modified)

Systematically updated all UI components and screens to use design tokens:

#### Core Components
- **Button.tsx**: Transparent outline style, emerald borders, no gradients/shadows
- **ChatInput.tsx**: Monospace, flat inputs, emerald accent
- **ChatMessage.tsx**: Flat message bubbles, minimal styling
- **VoiceRecordButton.tsx**: Simplified states with new color palette

#### All Screens Updated
- **HomeScreen.tsx**: RAM/memory display with display typography, uppercase labels
- **ChatsListScreen.tsx**: Minimal conversation cards
- **ModelsScreen.tsx**: Flat model cards with emerald accents
- **ProjectsScreen.tsx**: Simplified project cards
- **ProjectDetailScreen.tsx**: Clean detail view
- **ProjectEditScreen.tsx**: Streamlined editing interface
- **SettingsScreen.tsx**: Consistent settings UI
- **GalleryScreen.tsx**: Minimal image grid
- **DownloadManagerScreen.tsx**: Clean download progress UI
- *(+ 11 more screens)*

### 3. **Design Patterns Established**

Consistent patterns across all components:
- **Labels:** Always uppercase, `TYPOGRAPHY.label`, muted color (whispers, not shouts)
- **Metadata:** `TYPOGRAPHY.meta`, parentheses for inline, bullets for lists
- **Buttons:** Transparent backgrounds with borders (emerald for primary, gray for secondary)
- **Cards:** `COLORS.surface` background, `8px` border radius, subtle borders
- **Spacing:** Use tokens only — no magic numbers
- **Typography:** Spread operator for base styles, override specifics

---

## Key Design Decisions

### Philosophy
- **Brutalist/Terminal-inspired:** Monospace, high contrast, functional
- **Minimal:** Remove decoration, focus on content
- **Single accent:** Emerald green only, used sparingly
- **Information density:** Respect screen space, compact where appropriate

### Typography Strategy
- **Display (22px, weight 200):** Large numbers (RAM, metrics)
- **H1 (24px, weight 300):** Screen titles
- **H2 (16px, weight 400):** Section headers
- **Label (10px, weight 400, +0.3 letter-spacing):** Uppercase labels
- **Meta (10px, weight 300):** Performance data, timestamps

### Color Strategy
- **Primary:** Emerald (`#34D399`) for active states, focus, important actions only
- **Backgrounds:** Three-tier system (background → surface → surfaceLight)
- **Text:** White → gray → muted hierarchy (no colors except semantic)
- **Borders:** Subtle (`#1E1E1E`) unless focused (emerald)

### Spacing Strategy
- **Screen padding:** `SPACING.xl` (24px)
- **Card padding:** `SPACING.lg` (16px)
- **List gaps:** `SPACING.sm` (8px)
- **Component gaps:** `SPACING.md` (12px)

---

## Technical Details

### Files Modified (20 total)

**Design System:**
- `src/constants/index.ts` — Added TYPOGRAPHY, SPACING, updated COLORS

**Components:**
- `src/components/Button.tsx`
- `src/components/ChatInput.tsx`
- `src/components/ChatMessage.tsx`
- `src/components/VoiceRecordButton.tsx`

**Screens:**
- `src/screens/HomeScreen.tsx`
- `src/screens/ChatsListScreen.tsx`
- `src/screens/DownloadManagerScreen.tsx`
- `src/screens/GalleryScreen.tsx`
- `src/screens/ModelDownloadScreen.tsx`
- `src/screens/ModelsScreen.tsx`
- `src/screens/PassphraseSetupScreen.tsx`
- `src/screens/ProjectDetailScreen.tsx`
- `src/screens/ProjectEditScreen.tsx`
- `src/screens/ProjectsScreen.tsx`
- `src/screens/SecuritySettingsScreen.tsx`
- `src/screens/SettingsScreen.tsx`
- `src/screens/StorageSettingsScreen.tsx`
- `src/screens/VoiceSettingsScreen.tsx`

**Documentation:**
- `docs/CODEBASE_GUIDE.md` — Updated color palette section
- `docs/DESIGN_PHILOSOPHY_SYSTEM.md` — NEW: Complete design system documentation

### Code Patterns

**Before:**
```typescript
const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#6366F1',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
});
```

**After:**
```typescript
import { COLORS, SPACING, TYPOGRAPHY } from '../constants';

const styles = StyleSheet.create({
  title: {
    ...TYPOGRAPHY.h1,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  button: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: 8,
  },
});
```

---

## Before vs After

### Visual Transformation

| Aspect | Before | After |
|--------|--------|-------|
| **Background** | Dark blue (#0F172A) | Pure black (#0A0A0A) |
| **Primary accent** | Purple (#6366F1) | Emerald (#34D399) |
| **Typography** | Mixed fonts, varied weights | Menlo monospace only, weights 200-400 |
| **Buttons** | Filled colored backgrounds | Transparent with borders |
| **Border radius** | 12px (rounded) | 8px (sharp) |
| **Shadows** | Present on cards | None (flat) |
| **Labels** | Mixed case | Always uppercase |
| **Color usage** | Multiple accent colors | Single emerald accent |
| **Aesthetic** | Modern, colorful | Terminal, brutalist |

### Example: HomeScreen

**Before:**
- Purple "New Chat" button
- Mixed fonts and sizes
- Colorful badges
- Rounded corners everywhere

**After:**
- Emerald outline "NEW CHAT" button
- Monospace Menlo throughout
- Minimal emerald accents
- Sharp 8px borders
- Uppercase labels: "ACTIVE MODEL", "MEMORY"
- Display typography for large numbers (RAM usage)
- Metadata in small, muted text

---

## Design System Guidelines

### For Future Development

1. **Always use design tokens** — Import from `src/constants/index.ts`
2. **No magic numbers** — Use `SPACING.*` for all padding/margins
3. **No hardcoded colors** — Use `COLORS.*` palette only
4. **No mixed fonts** — Menlo monospace everywhere
5. **Labels are uppercase** — Use `TYPOGRAPHY.label` with `textTransform: 'uppercase'`
6. **Emerald is special** — Only for active states, focus, primary actions
7. **Buttons are outlined** — Transparent with borders, not filled
8. **8px border radius** — Sharp, minimal corners
9. **No shadows or gradients** — Flat design only
10. **Metadata is small and muted** — Use `TYPOGRAPHY.meta`

### Component Checklist

When creating or updating components:
- [ ] Imports design tokens from `src/constants`
- [ ] Uses `TYPOGRAPHY.*` spread operator for text styles
- [ ] Uses `SPACING.*` for all spacing values
- [ ] Uses `COLORS.*` for all color values
- [ ] Labels are uppercase with proper letter spacing
- [ ] Buttons follow outline pattern
- [ ] No shadows, gradients, or decorative elements
- [ ] Consistent with brutalist aesthetic

---

## Documentation

Two key documents created:

1. **DESIGN_PHILOSOPHY_SYSTEM.md** (this file)
   - Complete design system reference
   - All design tokens documented
   - Component patterns and anti-patterns
   - Implementation guide with checklist

2. **CODEBASE_GUIDE.md** (updated)
   - Color palette section updated
   - References new design system

---

## Next Steps / Considerations

### Potential Future Work

1. **Dark theme toggle?** — Currently pure black only; consider if users want lighter options
2. **Accessibility audit** — Verify contrast ratios meet WCAG standards
3. **Component library** — Extract reusable components with consistent styling
4. **Animation guidelines** — Define functional animations (loading, transitions)
5. **Icon system** — Ensure icons match brutalist aesthetic
6. **Image generation UI** — Apply design system to image-specific screens
7. **Onboarding** — Update onboarding slides with new design

### Known Improvements Needed

- [ ] Test on various screen sizes (small phones, tablets)
- [ ] Verify touch targets are ≥ 44px for accessibility
- [ ] Check contrast ratios for muted text
- [ ] Ensure monospace doesn't cause layout issues on small screens
- [ ] Test with real users for readability feedback

### Git Status

All changes are currently **staged but not committed**. Ready to commit with message:

```
feat: implement brutalist design system with monochromatic palette

- Add typography scale (Menlo monospace throughout)
- Add spacing scale (xs to xxl)
- Update color palette to monochromatic with emerald accent
- Refactor all components to use design tokens
- Update all screens with consistent styling
- Create comprehensive design system documentation

BREAKING CHANGE: Complete visual redesign from colorful rounded UI
to minimal brutalist aesthetic. No API changes, purely visual.
```

---

## Quick Reference

### Most Common Patterns

**Screen container:**
```typescript
container: {
  flex: 1,
  backgroundColor: COLORS.background,
  padding: SPACING.xl,
}
```

**Section header:**
```typescript
sectionHeader: {
  ...TYPOGRAPHY.label,
  color: COLORS.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  marginBottom: SPACING.sm,
}
```

**Card:**
```typescript
card: {
  backgroundColor: COLORS.surface,
  padding: SPACING.lg,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: COLORS.border,
}
```

**Primary button:**
```typescript
button: {
  backgroundColor: 'transparent',
  borderWidth: 1,
  borderColor: COLORS.primary,
  paddingVertical: SPACING.md,
  paddingHorizontal: SPACING.lg,
  borderRadius: 8,
}
buttonText: {
  ...TYPOGRAPHY.body,
  color: COLORS.primary,
}
```

**Metadata display:**
```typescript
metadata: {
  ...TYPOGRAPHY.meta,
  color: COLORS.textSecondary,
}
```

---

## Context for Next Chat

When continuing this work:

1. **Design system is fully implemented** in `src/constants/index.ts`
2. **All screens updated** to use tokens (20 files modified)
3. **Documentation complete** in `docs/DESIGN_PHILOSOPHY_SYSTEM.md`
4. **Git status:** All changes staged, ready to commit
5. **Testing needed:** Visual QA on different devices/screen sizes
6. **Philosophy:** Brutalist, terminal-inspired, emerald accent only, Menlo monospace

Key files to reference:
- `src/constants/index.ts` — Design token source
- `docs/DESIGN_PHILOSOPHY_SYSTEM.md` — Complete design guide
- `docs/CODEBASE_GUIDE.md` — Architecture reference

**Core principle:** Remove decoration, focus on functionality, maintain consistency through tokens, respect the brutalist aesthetic.
