/**
 * Checklist component tests — covers ProgressBar, animations, useOnboardingSteps,
 * useChecklistTheme, useAutoDismiss, and OnboardingSheet rendering.
 */

import React from 'react';
import { render, act, renderHook, waitFor } from '@testing-library/react-native';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import { resetStores } from '../../utils/testHelpers';
import { createDownloadedModel } from '../../utils/factories';
import { refreshMobileModelServices, selectMobileModel } from '../../../src/services/modelServices';

// ─── ProgressBar ────────────────────────────────────────────────────
describe('ProgressBar', () => {

  const { ProgressBar } = require('../../../src/components/checklist/ProgressBar');

  const baseTheme = {
    progressTrackColor: '#ccc',
    progressFillColor: '#007AFF',
    progressHeight: 4,
    progressBorderRadius: 2,
    progressTextColor: '#666',
    progressTextFontSize: 11,
  };

  it('renders completed/total text', () => {
    const { getByText } = render(<ProgressBar completed={3} total={6} theme={baseTheme} />);
    expect(getByText('3/6')).toBeTruthy();
  });

  it('renders 0/0 when total is 0', () => {
    const { getByText } = render(<ProgressBar completed={0} total={0} theme={baseTheme} />);
    expect(getByText('0/0')).toBeTruthy();
  });

  it('renders fully completed state', () => {
    const { getByText } = render(<ProgressBar completed={6} total={6} theme={baseTheme} />);
    expect(getByText('6/6')).toBeTruthy();
  });
});

// ─── Animations ─────────────────────────────────────────────────────
describe('checklist animations', () => {

  const { useStaggeredEntrance, useCheckmark, useStrikethrough, useProgressAnimation } =
    require('../../../src/components/checklist/animations');

  const spring = { damping: 24, stiffness: 140 };

  it('useStaggeredEntrance returns array of Animated.Values', () => {
    const { result } = renderHook(() => useStaggeredEntrance(3, true, spring));
    expect(result.current).toHaveLength(3);
  });

  it('useStaggeredEntrance handles expanded=false', () => {
    const { result } = renderHook(() => useStaggeredEntrance(2, false, spring));
    expect(result.current).toHaveLength(2);
  });

  it('useCheckmark returns fillProgress, checkScale, pulse', () => {
    const { result } = renderHook(() => useCheckmark(false, spring));
    expect(result.current.fillProgress).toBeDefined();
    expect(result.current.checkScale).toBeDefined();
    expect(result.current.pulse).toBeDefined();
  });

  it('useCheckmark with completed=true animates', () => {
    const { result } = renderHook(() => useCheckmark(true, spring));
    expect(result.current.fillProgress).toBeDefined();
  });

  it('useStrikethrough returns Animated.Value', () => {
    const { result } = renderHook(() => useStrikethrough(false));
    expect(result.current).toBeDefined();
  });

  it('useStrikethrough with completed=true', () => {
    const { result } = renderHook(() => useStrikethrough(true));
    expect(result.current).toBeDefined();
  });

  it('useProgressAnimation returns Animated.Value', () => {
    const { result } = renderHook(() => useProgressAnimation(0.5));
    expect(result.current).toBeDefined();
  });
});

// ─── useOnboardingSteps ─────────────────────────────────────────────
describe('useOnboardingSteps', () => {

  const { useOnboardingSteps } = require('../../../src/components/checklist/useOnboardingSteps');

  beforeEach(() => resetStores());

  it('returns 6 steps with 0 completed initially', () => {
    const { result } = renderHook(() => useOnboardingSteps());
    expect(result.current.steps).toHaveLength(6);
    expect(result.current.completedCount).toBe(0);
    expect(result.current.totalCount).toBe(6);
  });

  it('marks downloadedModel as completed when models exist', async () => {
    act(() => { useAppStore.getState().addDownloadedModel(createDownloadedModel()); });
    const { result } = renderHook(() => useOnboardingSteps());
    await act(refreshMobileModelServices);
    await waitFor(() => {
      const step = result.current.steps.find((s: any) => s.id === 'downloadedModel');
      expect(step.completed).toBe(true);
      expect(result.current.completedCount).toBe(1);
    });
  });

  it('marks loadedModel as completed when a real local route is selected', async () => {
    act(() => { useAppStore.getState().addDownloadedModel(createDownloadedModel({ id: 'model-1' })); });
    const { result } = renderHook(() => useOnboardingSteps());
    await act(async () => {
      await selectMobileModel({ source: 'local', hostId: 'llama', modality: 'text', modelId: 'model-1' });
    });
    await waitFor(() => {
      const step = result.current.steps.find((s: any) => s.id === 'loadedModel');
      expect(step.completed).toBe(true);
    });
  });

  it('marks sentMessage as completed when a conversation has messages', () => {
    act(() => {
      const convId = useChatStore.getState().createConversation('m1', 'Test');
      useChatStore.getState().addMessage(convId, { role: 'user', content: 'hi' });
    });
    const { result } = renderHook(() => useOnboardingSteps());
    const step = result.current.steps.find((s: any) => s.id === 'sentMessage');
    expect(step.completed).toBe(true);
  });

  it('disables triedImageGen when no model is loaded', () => {
    const { result } = renderHook(() => useOnboardingSteps());
    const step = result.current.steps.find((s: any) => s.id === 'triedImageGen');
    expect(step.disabled).toBe(true);
  });

  it('marks createdProject when 5+ projects exist', () => {
    act(() => {
      for (let i = 0; i < 5; i++) {
        useProjectStore.getState().createProject({ name: `Project ${i}`, description: '', systemPrompt: '' });
      }
    });
    const { result } = renderHook(() => useOnboardingSteps());
    const step = result.current.steps.find((s: any) => s.id === 'createdProject');
    expect(step.completed).toBe(true);
  });
});

// ─── useChecklistTheme ──────────────────────────────────────────────
describe('useChecklistTheme', () => {

  const { useChecklistTheme } = require('../../../src/components/checklist/useOnboardingSteps');

  it('returns a theme object with all required properties', () => {
    const { result } = renderHook(() => useChecklistTheme());
    expect(result.current.progressTrackColor).toBeDefined();
    expect(result.current.progressFillColor).toBeDefined();
    expect(result.current.checkboxSize).toBe(18);
    expect(result.current.springDamping).toBe(24);
  });
});

// ─── useAutoDismiss ─────────────────────────────────────────────────
describe('useAutoDismiss', () => {

  const { useAutoDismiss } = require('../../../src/components/checklist/useOnboardingSteps');

  beforeEach(() => {
    jest.useFakeTimers();
    resetStores();
  });

  afterEach(() => jest.useRealTimers());

  it('dismisses checklist after 3s when all steps completed', () => {
    renderHook(() => useAutoDismiss(6, 6));
    expect(useAppStore.getState().checklistDismissed).toBe(false);
    act(() => { jest.advanceTimersByTime(3000); });
    expect(useAppStore.getState().checklistDismissed).toBe(true);
  });

  it('does NOT dismiss when not all steps completed', () => {
    renderHook(() => useAutoDismiss(3, 6));
    act(() => { jest.advanceTimersByTime(5000); });
    expect(useAppStore.getState().checklistDismissed).toBe(false);
  });

  it('does NOT dismiss when total is 0', () => {
    renderHook(() => useAutoDismiss(0, 0));
    act(() => { jest.advanceTimersByTime(5000); });
    expect(useAppStore.getState().checklistDismissed).toBe(false);
  });
});
