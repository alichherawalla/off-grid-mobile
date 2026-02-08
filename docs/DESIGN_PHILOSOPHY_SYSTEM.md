# LocalLLM Design Philosophy & System

## Core Philosophy

LocalLLM follows a **brutalist, minimal design system** inspired by terminal aesthetics and focused on functionality over decoration. The interface emphasizes clarity, efficiency, and respect for the user's attention.

---

## Design Principles

### 1. **Minimal & Functional**
- No unnecessary decoration or embellishment
- Every element serves a purpose
- Remove before adding
- Silence over noise

### 2. **Terminal-Inspired Aesthetic**
- Monospace typography (`Menlo`) throughout
- Pure black background (`#0A0A0A`)
- Single accent color (emerald green `#34D399`)
- High contrast for readability
- Crisp borders and sharp edges

### 3. **Consistent Patterns**
- Use centralized design tokens (typography, spacing, colors)
- No magic numbers in component styles
- Maintain visual hierarchy through size and weight, not color
- Predictable interactions

### 4. **Information Density**
- Respect screen real estate
- Compact layouts where appropriate
- Progressive disclosure (hide complexity until needed)
- Metadata as "whispers" not shouts

### 5. **Performance First**
- Lightweight components
- No unnecessary animations (functional animations only)
- Fast, responsive interactions
- Optimize for lower-end devices

---

## Design System

### Typography Scale

All text uses **Menlo** (monospace) for consistency and readability.

| Token | Size | Weight | Use Case | Example |
|-------|------|--------|----------|---------|
| `TYPOGRAPHY.display` | 22px | 200 | Hero numbers, RAM display | "8.2 GB" |
| `TYPOGRAPHY.h1` | 24px | 300 | Screen titles | "Conversations" |
| `TYPOGRAPHY.h2` | 16px | 400 | Section headers | "Downloaded Models" |
| `TYPOGRAPHY.h3` | 13px | 400 | Subsection headers | "Text Models" |
| `TYPOGRAPHY.body` | 14px | 400 | Primary body text | Message content |
| `TYPOGRAPHY.bodySmall` | 13px | 400 | Secondary body text | Descriptions |
| `TYPOGRAPHY.label` | 10px | 400 | Labels, whispers | "ACTIVE MODEL" |
| `TYPOGRAPHY.labelSmall` | 9px | 400 | Tiny labels | Badges |
| `TYPOGRAPHY.meta` | 10px | 300 | Metadata | "12.3 tok/s" |
| `TYPOGRAPHY.metaSmall` | 9px | 300 | Tiny metadata | Timestamps |

**Typography Rules:**
- Use `display` for large numeric displays (memory, performance metrics)
- Use `h1` for screen titles
- Use `h2` for major sections
- Use `h3` for subsections within cards
- Use `label` for uppercase labels and section markers ("whispers")
- Use `meta` for secondary information (timestamps, performance data)
- Maintain consistent letter spacing: tight (-0.5) for large text, loose (+0.3) for small labels

---

### Spacing Scale

Use the spacing scale for all margins, paddings, and gaps.

| Token | Value | Use Case |
|-------|-------|----------|
| `SPACING.xs` | 4px | Tight spacing, icon gaps |
| `SPACING.sm` | 8px | Small padding, list item gaps |
| `SPACING.md` | 12px | Standard padding |
| `SPACING.lg` | 16px | Card padding, section spacing |
| `SPACING.xl` | 24px | Screen padding, major sections |
| `SPACING.xxl` | 32px | Large screen padding, hero sections |

**Spacing Rules:**
- Screen-level padding: `SPACING.xl` (24px)
- Card padding: `SPACING.lg` (16px)
- Button padding: `SPACING.sm` or `SPACING.md`
- List item gaps: `SPACING.sm`
- Icon-to-text gaps: `SPACING.sm`
- Section breaks: `SPACING.xl` or `SPACING.xxl`

---

### Color System

Monochromatic palette with emerald green as the only accent.

#### Primary Accent
| Token | Hex | Use Case |
|-------|-----|----------|
| `COLORS.primary` | `#34D399` | Main accent, active states, borders |
| `COLORS.primaryDark` | `#10B981` | Pressed states |
| `COLORS.primaryLight` | `#6EE7B7` | Subtle highlights |

#### Backgrounds
| Token | Hex | Use Case |
|-------|-----|----------|
| `COLORS.background` | `#0A0A0A` | App background (pure black) |
| `COLORS.surface` | `#141414` | Cards, elevated elements |
| `COLORS.surfaceLight` | `#1E1E1E` | Nested elements, inputs |
| `COLORS.surfaceHover` | `#252525` | Hover states |

#### Text Hierarchy
| Token | Hex | Use Case |
|-------|-----|----------|
| `COLORS.text` | `#FFFFFF` | Primary text (pure white) |
| `COLORS.textSecondary` | `#B0B0B0` | Secondary text |
| `COLORS.textMuted` | `#808080` | Tertiary text, placeholders |
| `COLORS.textDisabled` | `#4A4A4A` | Disabled text |

#### Borders
| Token | Hex | Use Case |
|-------|-----|----------|
| `COLORS.border` | `#1E1E1E` | Default borders |
| `COLORS.borderLight` | `#2A2A2A` | Subtle lighter borders |
| `COLORS.borderFocus` | `#34D399` | Focused/active borders (primary) |

#### Semantic Colors
| Token | Hex | Use Case |
|-------|-----|----------|
| `COLORS.success` | `#22C55E` | Success states |
| `COLORS.warning` | `#F59E0B` | Warnings |
| `COLORS.error` | `#EF4444` | Errors |
| `COLORS.info` | `#3B82F6` | Informational |

#### Special
| Token | Hex | Use Case |
|-------|-----|----------|
| `COLORS.overlay` | `rgba(0, 0, 0, 0.7)` | Modal backgrounds |
| `COLORS.divider` | `#1A1A1A` | Subtle dividers |

**Color Rules:**
- Use emerald (`primary`) sparingly — only for active states, focus, and important actions
- Prefer monochrome hierarchy (white → gray → muted) over color variation
- Semantic colors (success, warning, error) only for their intended purpose
- Borders should be subtle (`border`) unless focused (`borderFocus`)
- Backgrounds should use the three-tier system: `background` → `surface` → `surfaceLight`

---

### Component Patterns

#### Buttons
- **Default:** Transparent with border (outline style)
- **Primary:** Transparent with emerald border, emerald text
- **Secondary:** Transparent with gray border, white text
- **Ghost:** No border, just text
- Padding: Use spacing scale (`sm`, `md`, `lg` for different sizes)
- Border radius: `8px` (sharp, minimal)
- No shadows or gradients

#### Cards
- Background: `COLORS.surface`
- Padding: `SPACING.lg`
- Border radius: `8px`
- Border: `1px solid COLORS.border`
- Hover state (if interactive): `backgroundColor: COLORS.surfaceHover`

#### Text Inputs
- Background: `COLORS.surfaceLight`
- Border: `1px solid COLORS.border`
- Focus border: `COLORS.borderFocus`
- Padding: `SPACING.md`
- Border radius: `8px`
- Monospace font

#### Labels & Headers
- Use `TYPOGRAPHY.label` or `TYPOGRAPHY.labelSmall`
- **Always uppercase** (e.g., "ACTIVE MODEL", "DOWNLOADED MODELS")
- Color: `COLORS.textMuted` (whisper, not shout)
- Letter spacing: `+0.3` for readability
- Purpose: Visual anchors, not primary content

#### Metadata Display
- Use `TYPOGRAPHY.meta` or `TYPOGRAPHY.metaSmall`
- Color: `COLORS.textSecondary` or `COLORS.textMuted`
- Parentheses for inline metadata: `(12.3 tok/s)`
- Bullets for lists: `• Metal • 99 layers`
- Keep concise: numbers + abbreviations

---

## UI Patterns

### Information Hierarchy

1. **Primary:** Screen title (h1) or main content (body)
2. **Secondary:** Section headers (h2, h3) or descriptions (bodySmall)
3. **Tertiary:** Labels (label), metadata (meta), timestamps (metaSmall)

### Whitespace

- Generous top-level spacing (`SPACING.xl`, `SPACING.xxl`)
- Tighter spacing within components (`SPACING.sm`, `SPACING.md`)
- Breathing room around text (`SPACING.md` minimum)
- Avoid cramped layouts — let content breathe

### States

| State | Visual Treatment |
|-------|------------------|
| **Default** | Normal colors, subtle borders |
| **Hover** | `COLORS.surfaceHover` background |
| **Active/Pressed** | `COLORS.primaryDark` accent |
| **Focused** | `COLORS.borderFocus` border |
| **Disabled** | 40% opacity, `COLORS.textDisabled` |
| **Loading** | Subtle spinner, muted text |

### Feedback

- **Success:** Brief green flash or checkmark
- **Error:** Red text + error icon
- **Loading:** Minimal spinner (no elaborate animations)
- **Empty states:** Simple message + optional action button

---

## Anti-Patterns (What to Avoid)

❌ **Colorful gradients or shadows** — Keep it flat and monochrome
❌ **Multiple accent colors** — Emerald only
❌ **Rounded pill shapes** — Use minimal `8px` radius
❌ **Decorative animations** — Only functional animations (loading, state transitions)
❌ **Mixed font families** — Menlo only
❌ **Heavy borders or 3D effects** — Flat, sharp, minimal
❌ **Large empty spaces without purpose** — Dense when appropriate
❌ **Color-coded information** — Use hierarchy, not color
❌ **Cluttered layouts** — Remove before adding

---

## Implementation Guide

### Using Design Tokens

Always import and use design tokens from `src/constants/index.ts`:

```typescript
import { COLORS, FONTS, SPACING, TYPOGRAPHY } from '../constants';

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    padding: SPACING.xl,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  label: {
    ...TYPOGRAPHY.label,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
```

### Component Checklist

When building or refactoring a component:

- [ ] Uses design tokens (no hardcoded colors, sizes, or fonts)
- [ ] Follows typography scale (`TYPOGRAPHY.*`)
- [ ] Uses spacing scale for all padding/margin (`SPACING.*`)
- [ ] Colors from palette only (`COLORS.*`)
- [ ] Labels are uppercase with proper typography
- [ ] Metadata uses appropriate meta styles
- [ ] Buttons follow button patterns (transparent + border)
- [ ] Cards use surface colors with minimal borders
- [ ] No shadows, gradients, or decorative elements
- [ ] States (hover, focus, disabled) properly styled
- [ ] Accessible (sufficient contrast, touch targets ≥ 44px)

---

## Philosophy in Practice

### Example: Model Card

**Before (decorative, colorful):**
- Gradient background
- Multiple colors for badges
- Large shadows
- Rounded pill shapes
- Mixed fonts

**After (brutalist, minimal):**
- Flat `COLORS.surface` background
- Single emerald accent for active state
- Sharp `8px` border radius
- Monospace font throughout
- Uppercase label for section ("DOWNLOADED MODELS")
- Metadata as small, muted text
- Subtle border, no shadow

### Example: Chat Message

**Before:**
- Bubble-style messages with gradients
- Colorful avatars
- Large padding, rounded corners
- Mixed fonts for metadata

**After:**
- Flat background (`COLORS.surface`)
- No avatars (text-first)
- Compact padding (`SPACING.md`)
- Sharp edges
- Metadata in tiny, muted monospace
- Role indicated by position and subtle color, not decoration

---

## Design Evolution

This design system was intentionally created to:

1. **Differentiate** from typical chat apps (iOS Messages, WhatsApp)
2. **Signal technical capability** through terminal aesthetics
3. **Respect privacy** with dark, unobtrusive UI
4. **Optimize for content** — let the AI responses shine
5. **Perform well** on low-end devices (no heavy rendering)
6. **Age gracefully** — minimalism doesn't go out of style

As the app evolves:
- **Stay true to brutalism** — add functionality, not decoration
- **Maintain consistency** — use tokens religiously
- **Question additions** — does this serve the user or just look nice?
- **Optimize for density** — information should be easy to scan

---

## References

- **Design Token Source:** `src/constants/index.ts`
- **Codebase Guide:** `docs/CODEBASE_GUIDE.md`
- **Typography:** All Menlo, weights 200-400 only
- **Inspiration:** Terminal UIs, Linear, Vercel, brutalist web design

---

**Remember:** Silence, clarity, and function over form. Let the AI's capabilities speak, not the interface.
