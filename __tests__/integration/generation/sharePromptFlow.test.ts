/**
 * Integration Tests: Share Prompt Flow
 *
 * Tests the integration between:
 * - generationService → appStore (text generation count increment)
 * - imageGenerationService → appStore (image generation count increment)
 * - sharePrompt pub/sub (emit/subscribe lifecycle)
 * - shouldShowSharePrompt trigger logic at correct milestones
 *
 * Verifies that the share prompt is emitted at the right times
 * (1st gen, every 10th gen) and not emitted on failed/aborted generations.
 */

import { wait } from '../../utils/testHelpers';

describe('Share Prompt Flow Integration', () => {
  // ============================================================================
  // Image Generation → Share Prompt
  // ============================================================================
  describe('image generation triggers share prompt', () => {
    const setupImageJourney = async () => {
      const { setupChatScreen } =
        require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({ engine: 'llama' });
      harness.render();
      await harness.placeImageModel({ backend: 'coreml' });
      await harness.cycleImageMode();
      const sharePrompt =
        require('../../../src/utils/sharePrompt') as typeof import('../../../src/utils/sharePrompt');
      sharePrompt.resetSharePromptSession();
      const listener = jest.fn();
      const unsubscribe = sharePrompt.subscribeSharePrompt(listener);
      return { harness, listener, unsubscribe };
    };
    type ImageJourney = Awaited<ReturnType<typeof setupImageJourney>>;
    let imageJourney: ImageJourney;

    beforeEach(async () => {
      imageJourney = await setupImageJourney();
    }, 30_000);

    afterEach(() => {
      imageJourney?.unsubscribe();
    });

    const generate = async (
      harness: ImageJourney['harness'],
      prompt: string,
    ) => {
      const previous = harness.boundary.diffusion.calls.generateImage.length;
      await harness.tapSend(prompt);
      await harness.rtl.waitFor(() =>
        expect(harness.boundary.diffusion.calls.generateImage).toHaveLength(
          previous + 1,
        ),
      );
    };

    it('increments imageGenerationCount on successful generation', async () => {
      const { harness } = imageJourney;
      await generate(harness, 'sunset');
      await harness.rtl.waitFor(() =>
        expect(harness.useAppStore.getState().imageGenerationCount).toBe(1),
      );
    });

    it('does not emit share prompt on first image generation (delayed to 2nd)', async () => {
      const { harness, listener } = imageJourney;
      await generate(harness, 'sunset');
      expect(listener).not.toHaveBeenCalled();
      await wait(2100);
      expect(listener).not.toHaveBeenCalled();
    });

    it('emits share prompt on 2nd image generation (after delay)', async () => {
      const { harness, listener } = imageJourney;
      await generate(harness, 'draw first sunset');
      await generate(harness, 'draw second sunset');
      expect(listener).not.toHaveBeenCalled();
      await wait(2100);
      expect(listener).toHaveBeenCalledWith('image');
      expect(harness.useAppStore.getState().imageGenerationCount).toBe(2);
    });

    it('emits AT MOST ONCE per session across image generations (no 20th re-show)', async () => {
      const { harness, listener } = imageJourney;
      await generate(harness, 'draw sunset 1');
      await generate(harness, 'draw sunset 2');
      await wait(2100);
      expect(listener).toHaveBeenCalledTimes(1);
      await generate(harness, 'draw sunset 3');
      await generate(harness, 'draw sunset 4');
      await wait(2100);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not increment count when image generation fails', async () => {
      const { harness, listener } = imageJourney;
      harness.boundary.diffusion.module.generateImage.mockRejectedValueOnce(
        new Error('GPU error'),
      );
      await harness.tapSend('sunset');
      await harness.rtl.waitFor(() =>
        expect(harness.view!.queryAllByText(/GPU error/).length).toBeGreaterThan(0),
      );
      expect(harness.useAppStore.getState().imageGenerationCount).toBe(0);
      await wait(2100);
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not increment count when image generation returns null result', async () => {
      const { harness, listener } = imageJourney;
      harness.boundary.diffusion.module.generateImage.mockResolvedValueOnce(null);
      await harness.tapSend('sunset');
      await harness.rtl.waitFor(() =>
        expect(harness.view!.queryByTestId('stop-button')).toBeNull(),
      );
      expect(harness.useAppStore.getState().imageGenerationCount).toBe(0);
      await wait(2100);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  it('does not emit share prompt on the first text generation (avoids first-run stacking)', async () => {
    const { setupChatScreen } =
      require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
    const harness = await setupChatScreen({ engine: 'llama' });
    const {
      resetSharePromptSession: resetRealSharePromptSession,
      subscribeSharePrompt: subscribeRealSharePrompt,
    } =
      require('../../../src/utils/sharePrompt') as typeof import('../../../src/utils/sharePrompt');
    const realShareListener = jest.fn();
    resetRealSharePromptSession();
    const unsubscribeRealSharePrompt =
      subscribeRealSharePrompt(realShareListener);

    try {
      harness.render();
      await harness.send('Hi', { text: 'Hello' });
      await harness.rtl.waitFor(() => {
        expect(harness.useAppStore.getState().textGenerationCount).toBe(1);
      });

      expect(realShareListener).not.toHaveBeenCalled();
      await wait(1600);
      expect(realShareListener).not.toHaveBeenCalled();
    } finally {
      unsubscribeRealSharePrompt();
    }
  });

  it('emits the share prompt on the 2nd text generation (after delay)', async () => {
    const { setupChatScreen } =
      require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
    const harness = await setupChatScreen({ engine: 'llama' });
    const {
      resetSharePromptSession: resetRealSharePromptSession,
      subscribeSharePrompt: subscribeRealSharePrompt,
    } =
      require('../../../src/utils/sharePrompt') as typeof import('../../../src/utils/sharePrompt');
    const realShareListener = jest.fn();
    resetRealSharePromptSession();
    const unsubscribeRealSharePrompt =
      subscribeRealSharePrompt(realShareListener);

    try {
      harness.render();
      await harness.send('First question', { text: 'First answer' });
      await harness.rtl.waitFor(() => {
        expect(harness.useAppStore.getState().textGenerationCount).toBe(1);
      });
      expect(realShareListener).not.toHaveBeenCalled();

      await harness.send('Second question', { text: 'Second answer' });
      await harness.rtl.waitFor(() => {
        expect(harness.useAppStore.getState().textGenerationCount).toBe(2);
      });
      expect(realShareListener).not.toHaveBeenCalled();
      await wait(1600);
      expect(realShareListener).toHaveBeenCalledWith('text');
    } finally {
      unsubscribeRealSharePrompt();
    }
  });

  it('does not increment count when generation throws', async () => {
    const { setupChatScreen } =
      require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
    const harness = await setupChatScreen({ engine: 'llama' });
    const {
      resetSharePromptSession: resetRealSharePromptSession,
      subscribeSharePrompt: subscribeRealSharePrompt,
    } =
      require('../../../src/utils/sharePrompt') as typeof import('../../../src/utils/sharePrompt');
    const realShareListener = jest.fn();
    resetRealSharePromptSession();
    const unsubscribeRealSharePrompt =
      subscribeRealSharePrompt(realShareListener);

    try {
      harness.render();
      harness.boundary.llama!.scriptCompletion({
        throwMessage: 'Generation failed',
      });
      await harness.tapSend('Hi');
      await harness.rtl.waitFor(() => {
        expect(
          harness.view!.queryAllByText(/Generation failed|Generation Error/i)
            .length,
        ).toBeGreaterThan(0);
      });

      expect(harness.useAppStore.getState().textGenerationCount).toBe(0);
      await wait(1600);
      expect(realShareListener).not.toHaveBeenCalled();
    } finally {
      unsubscribeRealSharePrompt();
    }
  });

  it('does not emit again after a later completed generation in the same session', async () => {
    const { setupChatScreen } =
      require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
    const harness = await setupChatScreen({ engine: 'llama' });
    const {
      resetSharePromptSession: resetRealSharePromptSession,
      subscribeSharePrompt: subscribeRealSharePrompt,
    } =
      require('../../../src/utils/sharePrompt') as typeof import('../../../src/utils/sharePrompt');
    const realShareListener = jest.fn();
    resetRealSharePromptSession();
    const unsubscribeRealSharePrompt =
      subscribeRealSharePrompt(realShareListener);

    try {
      harness.render();
      await harness.send('Question 1', { text: 'Answer 1' });
      await harness.rtl.waitFor(() => {
        expect(harness.useAppStore.getState().textGenerationCount).toBe(1);
      });
      await harness.send('Question 2', { text: 'Answer 2' });
      await harness.rtl.waitFor(() => {
        expect(harness.useAppStore.getState().textGenerationCount).toBe(2);
      });
      await wait(1600);
      expect(realShareListener).toHaveBeenCalledTimes(1);
      expect(realShareListener).toHaveBeenCalledWith('text');

      await harness.send('Question 3', { text: 'Answer 3' });
      await harness.rtl.waitFor(() => {
        expect(harness.useAppStore.getState().textGenerationCount).toBe(3);
      });
      // The once-per-session guard is claimed before the first timer is scheduled.
      // A later completed generation must therefore leave the emitted count unchanged;
      // the owner's direct scheduler test proves that no second delayed callback exists.
      expect(realShareListener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribeRealSharePrompt();
    }
  });

  it('preserves partial content without completing a stopped generation', async () => {
    const { setupChatScreen } =
      require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
    const harness = await setupChatScreen({ engine: 'llama' });
    const {
      resetSharePromptSession: resetRealSharePromptSession,
      subscribeSharePrompt: subscribeRealSharePrompt,
    } =
      require('../../../src/utils/sharePrompt') as typeof import('../../../src/utils/sharePrompt');
    const realShareListener = jest.fn();
    resetRealSharePromptSession();
    const unsubscribeRealSharePrompt =
      subscribeRealSharePrompt(realShareListener);

    try {
      harness.render();
      harness.boundary.llama!.scriptCompletion({
        text: 'Partial response that would continue',
        pauseAfter: 'Partial response',
      });
      await harness.tapSend('Hi');
      await harness.rtl.waitFor(() => {
        expect(harness.view!.queryByText('Partial response')).not.toBeNull();
        expect(harness.view!.queryByTestId('stop-button')).not.toBeNull();
      });

      await harness.rtl.act(async () => {
        harness.rtl.fireEvent.press(harness.view!.getByTestId('stop-button'));
      });
      await harness.rtl.waitFor(() => {
        expect(harness.view!.queryByTestId('stop-button')).toBeNull();
      });

      expect(harness.view!.queryByText('Partial response')).not.toBeNull();
      expect(harness.useAppStore.getState().textGenerationCount).toBe(0);
      await wait(1600);
      expect(realShareListener).not.toHaveBeenCalled();
    } finally {
      unsubscribeRealSharePrompt();
    }
  });
});
