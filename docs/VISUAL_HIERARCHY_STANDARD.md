# LocalLLM Visual Hierarchy Standard

## Purpose

This document defines the canonical visual hierarchy for ALL screens in LocalLLM. Use these 5 text categories to maintain consistent information architecture across the entire app.

---

## The 5 Text Categories

### 1. **TITLE** - Screen/Page Titles
**Purpose**: Top-level screen identification. The first thing users see.

**Typography Token**: `TYPOGRAPHY.h2`
**Size**: 16px
**Weight**: 400
**Color**: `COLORS.text` (#FFFFFF)
**Letter Spacing**: -0.2
**Transform**: Normal case (not uppercase)

**Usage**:
- Main screen titles in headers
- Primary identification of current location
- ONE per screen maximum

**Examples**:
- "Models"
- "Conversations"
- "Local LLM"
- "Download Your First Model"

**Do NOT use for**:
- Section headers within a screen (use SUBTITLE)
- Modal titles (use SUBTITLE)
- Hero text or large numbers (use display styles)

---

### 2. **SUBTITLE** - Section Headers & Modal Titles
**Purpose**: Secondary hierarchy. Organizes content into sections.

**Typography Token**: `TYPOGRAPHY.h3`
**Size**: 13px
**Weight**: 400
**Color**: `COLORS.text` (#FFFFFF) or `COLORS.textSecondary` (#B0B0B0)
**Letter Spacing**: -0.2

**Usage**:
- Section headers within a screen
- Modal/dialog titles
- Card titles
- Grouping labels (when not uppercase labels)

**Examples**:
- "Recommended Models"
- "Recent Conversations"
- "Downloaded Models"
- "Privacy Settings"

**Do NOT use for**:
- Main screen titles (use TITLE)
- Tiny uppercase labels (use LABEL)

---

### 3. **DESCRIPTION** - Explanatory Secondary Text
**Purpose**: Provides context, instructions, or secondary information about an element.

**Typography Token**: `TYPOGRAPHY.bodySmall`
**Size**: 13px
**Weight**: 400
**Color**: `COLORS.textSecondary` (#B0B0B0)
**Line Height**: 18-20px

**Usage**:
- Explanatory text below titles
- Help text and instructions
- Empty state messages (secondary line)
- Placeholder descriptions
- Feature explanations

**Examples**:
- "Based on your device (7.8GB RAM), we recommend these models..."
- "All conversations stay on your device"
- "Select from various AI models. Smaller models are faster..."
- "Enter your passphrase to unlock"

**Do NOT use for**:
- Main content/messages (use BODY)
- Tiny metadata (use META)

---

### 4. **BODY** - Primary Content Text
**Purpose**: The main readable content. Default text size for most interactions.

**Typography Token**: `TYPOGRAPHY.body`
**Size**: 14px
**Weight**: 400
**Color**: `COLORS.text` (#FFFFFF) or `COLORS.textSecondary` (#B0B0B0)
**Line Height**: 20px

**Usage**:
- Chat messages
- Form inputs
- Button labels
- List item primary text
- Main content paragraphs
- Settings options
- Default text when unsure

**Examples**:
- Message content in chat
- "Select a model to start chatting"
- Button text like "Download", "New Chat"
- Setting descriptions
- Input field content

**Do NOT use for**:
- Tiny metadata/timestamps (use META)
- Uppercase labels (use LABEL)
- Large screen titles (use TITLE)

---

### 5. **META** - Metadata & Timestamps
**Purpose**: Tiny supporting information. Should "whisper, not shout."

**Typography Token**: `TYPOGRAPHY.meta` or `TYPOGRAPHY.label` (uppercase)
**Size**: 10px (meta) or 9px (metaSmall)
**Weight**: 300 (meta) or 400 (label)
**Color**: `COLORS.textMuted` (#808080)
**Letter Spacing**: +0.3 (for labels)
**Transform**: UPPERCASE (for labels only)

**Usage**:
- Timestamps ("2h ago", "Yesterday")
- File sizes ("395.95 MB")
- Performance metrics ("12.3 tok/s")
- Technical details ("Q4_K_M", "Metal", "99 layers")
- Uppercase section labels ("ACTIVE MODEL", "DOWNLOADED MODELS")
- Badge text
- Tiny supporting info

**Examples**:
- "12 messages · 2h ago"
- "Q2_K • 395 MB • Low"
- "LOADED MODELS" (label, uppercase)
- "~4.2 GB RAM"
- "Available Memory"

**Do NOT use for**:
- Regular body text (use BODY)
- Descriptions (use DESCRIPTION)

---

## Visual Hierarchy Rules

### Size Hierarchy (Largest → Smallest)
1. **TITLE** (16px) - Screen titles
2. **BODY** (14px) - Main content
3. **SUBTITLE** (13px) - Section headers
4. **DESCRIPTION** (13px) - Explanatory text
5. **META** (10px) - Tiny metadata

### Color Hierarchy (Most Prominent → Least)
1. **Primary**: `COLORS.text` (#FFFFFF) - Titles, body, important info
2. **Secondary**: `COLORS.textSecondary` (#B0B0B0) - Descriptions, less important
3. **Muted**: `COLORS.textMuted` (#808080) - Metadata, whispers

### Weight Hierarchy
- **All weights 200-400** (never bold/600+)
- **Title/Body**: 400 (normal)
- **Meta**: 300 (light)
- **Display**: 200 (extra light, for large numbers)

---

## Decision Tree: "What Typography Should I Use?"

```
Is this the main screen title shown in the header?
├─ YES → TITLE (h2, 16px)
└─ NO ↓

Is this a section header, modal title, or card title?
├─ YES → SUBTITLE (h3, 13px)
└─ NO ↓

Is this explaining/describing something above it?
├─ YES → DESCRIPTION (bodySmall, 13px, muted)
└─ NO ↓

Is this main content, a message, input, or button?
├─ YES → BODY (body, 14px)
└─ NO ↓

Is this tiny supporting info, timestamp, or file size?
└─ YES → META (meta/label, 10px, muted)
```

---

## Common Mistakes to Avoid

❌ **Using h1 (24px) for screen titles** → Use h2 (16px) instead
❌ **Using body (14px) for metadata** → Use meta (10px) instead
❌ **Hardcoded font sizes** → Always use TYPOGRAPHY tokens
❌ **Mixing sizes within same category** → Be consistent
❌ **Using color for hierarchy alone** → Use size + color together
❌ **Bold weights (600+)** → Keep weights ≤400 for brutalist aesthetic
❌ **Emojis or emoticons ANYWHERE** → NEVER use emojis or emoticons in UI text, code, or messages. Use react-native-vector-icons (Feather) for icons.
❌ **Magic numbers for spacing** → Use SPACING tokens

---

## Screen Anatomy Example

```
┌─────────────────────────────────────┐
│ [TITLE: Models]                     │ ← h2 (16px)
├─────────────────────────────────────┤
│                                     │
│ ACTIVE MODEL                        │ ← META/LABEL (10px, uppercase)
│ SmolLM2-135M                       │ ← BODY (14px)
│ Q2_K • 395 MB                      │ ← META (10px)
│                                     │
│ [SUBTITLE: Downloaded Models]       │ ← h3 (13px)
│                                     │
│ Qwen 2.5 0.5B                      │ ← BODY (14px)
│ Tiny but capable model...          │ ← DESCRIPTION (13px, muted)
│ 395.95 MB • Q4_K_M • Low           │ ← META (10px)
│                                     │
└─────────────────────────────────────┘
```

---

## Reference: TYPOGRAPHY Tokens

| Token | Size | Weight | Use |
|-------|------|--------|-----|
| `display` | 22px | 200 | Large numbers (RAM, stats) |
| `h1` | 24px | 300 | **DEPRECATED for screens** - reserved for hero text |
| `h2` | 16px | 400 | **TITLE** - Screen titles |
| `h3` | 13px | 400 | **SUBTITLE** - Section headers |
| `body` | 14px | 400 | **BODY** - Main content |
| `bodySmall` | 13px | 400 | **DESCRIPTION** - Explanatory text |
| `label` | 10px | 400 | **META** - Uppercase labels |
| `labelSmall` | 9px | 400 | **META** - Tiny labels |
| `meta` | 10px | 300 | **META** - Metadata, timestamps |
| `metaSmall` | 9px | 300 | **META** - Tiny metadata |

---

## Enforcement Checklist

When creating or auditing a screen:

- [ ] Screen title uses `TYPOGRAPHY.h2` (TITLE)
- [ ] Section headers use `TYPOGRAPHY.h3` (SUBTITLE)
- [ ] Explanatory text uses `TYPOGRAPHY.bodySmall` (DESCRIPTION)
- [ ] Main content uses `TYPOGRAPHY.body` (BODY)
- [ ] Timestamps/metadata use `TYPOGRAPHY.meta` or `TYPOGRAPHY.label` (META)
- [ ] No hardcoded font sizes
- [ ] No weights > 400
- [ ] NEVER use emojis or emoticons anywhere (use Feather icons instead)
- [ ] Spacing uses SPACING tokens
- [ ] Colors follow hierarchy (text → textSecondary → textMuted)

---

**Last Updated**: February 2026
**Authority**: This document is the single source of truth for typography in LocalLLM.
