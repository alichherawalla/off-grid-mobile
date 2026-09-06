import { Platform } from 'react-native';
import {
  buildImageEnhancementMessages,
  cleanImageEnhancement,
  describeImageBackend,
  selectImageEnhancementContext,
} from '@offgrid/models';
import {
  isRuntimeOnlyMessage,
  PROMPT_ENHANCEMENT_REASONING_LABEL,
} from '@offgrid/sync';
import { useAppStore, useChatStore } from '../stores';
import { GeneratedImage, GenerationMeta, Message } from '../types';
import { parseModelOutput } from '../utils/messageContent';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { reportModelFailure } from './modelFailureHandler';
import { checkProPromptForImage } from './proPrompt';
import type {
  ImageGenerationState,
} from './imageGenerationTypes';

export function imagePhaseTransitionLog(
  previous: ImageGenerationState['phase'],
  state: Omit<ImageGenerationState, 'isGenerating'>,
): string {
  const status = state.status ? ` (${state.status})` : '';
  const error = state.error ? ` error=${state.error}` : '';
  return `[IMG-SM] phase ${previous} → ${state.phase}${status}${error}`;
}

export function reportEnhancementSkipped(reason: string): void {
  reportModelFailure('text', reason, {
    severity: 'warning',
    title: 'Prompt enhancement skipped',
    message: `Generating from your original prompt — ${reason}.`,
  });
}

export function scheduleImageSharePrompt(): void {
  const appStore = useAppStore.getState();
  const count = appStore.incrementImageGenerationCount();
  const delayMs = 2000;
  maybeScheduleSharePrompt({
    variant: 'image',
    count,
    hasEngaged: appStore.hasEngagedSharePrompt,
    delayMs,
  });
  checkProPromptForImage(delayMs);
}

interface ActiveImageModel {
  id: string;
  name: string;
  modelPath: string;
  backend?: string;
}

export function buildEnhancementMessages(
  prompt: string,
  contextMessages: Message[],
): Message[] {
  const portableContext = contextMessages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({ role: message.role as 'user' | 'assistant', content: message.content }));
  const shared = buildImageEnhancementMessages(prompt, portableContext);
  return [
    {
      id: 'system-enhance',
      role: 'system',
      content: shared[0].content,
      timestamp: Date.now(),
    },
    ...contextMessages,
    {
      id: 'user-enhance',
      role: 'user',
      content: shared[shared.length - 1]!.content,
      timestamp: Date.now(),
    },
  ];
}

/**
 * The conversation as a READER sees it, which is the only thing a model should be shown.
 *
 * Sending `message.content` sent the STORAGE form: the enhancement card's own container markup, and
 * our completion strings. Shown ten of those, the model stopped enhancing and started imitating -
 * it emitted `<think>__LABEL:Enhanced prompt__` token by token, and returned `Generated image for:
 * "Draw a fox"` as its idea of an enhanced prompt. A marker we invented for the screen must never
 * become model input.
 *
 * So: the enhancement's own cards are dropped, because they are this feature talking to itself and
 * carry no conversation, and everything else is passed through the one display parse.
 */
export function getConversationContext(conversationId: string): Message[] {
  const conversation = useChatStore
    .getState()
    .conversations.find(c => c.id === conversationId);
  if (!conversation?.messages) return [];
  return selectImageEnhancementContext(conversation.messages.map(message => {
    const parsed = parseModelOutput(message.content, message.reasoningContent);
    return {
      id: `ctx-${message.id}`,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      answer: parsed.answer,
      reasoning: parsed.reasoning,
      runtimeOnly: isRuntimeOnlyMessage({
        role: message.role,
        content: message.content,
        notice: message.isSystemInfo,
      }),
      generatedImage: Boolean(message.generationMeta?.resolution),
      promptEnhancement: parsed.reasoningLabel === PROMPT_ENHANCEMENT_REASONING_LABEL,
    };
  })) as Message[];
}

export function cleanEnhancedPrompt(raw: string): string {
  const clean = cleanImageEnhancement(raw);
  return isRuntimeOnlyMessage({ role: 'assistant', content: clean })
    ? ''
    : clean;
}

/** THE one writer of the "Enhanced prompt" card's message content — partial (streaming) and final
 *  both go through it, so the two can never disagree.
 *
 *  The card is a labelled `<think>` container the renderer turns into the collapsible block. Raw
 *  model output must NEVER be dropped into it verbatim: the model emits its own `<think>…</think>`,
 *  and a nested pair makes the outer container ambiguous (the first `</think>` closes it), which is
 *  how markup reached the screen. So the partial is run through the ONE display parse first and only
 *  its clean text is wrapped. While the model is still reasoning there is no answer yet — the
 *  reasoning is shown instead, so the card fills in live rather than sitting empty. */
export function buildEnhancementCardContent(raw: string): string {
  const { reasoning, answer } = parseModelOutput(raw);
  const body = (answer || reasoning || '').trim();
  return `<think>__LABEL:${PROMPT_ENHANCEMENT_REASONING_LABEL}__\n${body}</think>`;
}

export function buildImageGenMeta(
  model: ActiveImageModel,
  opts: {
    steps: number;
    guidanceScale: number;
    result: GeneratedImage;
    useOpenCL: boolean;
  },
): GenerationMeta {
  const backend = describeImageBackend(
    Platform.OS,
    model.backend,
    opts.useOpenCL,
  );
  return {
    ...backend,
    modelName: model.name,
    steps: opts.steps,
    guidanceScale: opts.guidanceScale,
    resolution: `${opts.result.width}x${opts.result.height}`,
  };
}
