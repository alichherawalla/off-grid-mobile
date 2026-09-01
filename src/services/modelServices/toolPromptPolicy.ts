import { prepareToolPromptMessages } from '@offgrid/models';
import type { Message } from '../../types';
import logger from '../../utils/logger';
import { getToolExtensions } from '../tools/extensions';
import { activeMobileRoute } from './mobileLLMService';

function deviceClockFacts(): { timezone: string; dayName: string } {
  try {
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      dayName: new Date().toLocaleDateString(undefined, { weekday: 'long' }),
    };
  } catch {
    return { timezone: '', dayName: '' };
  }
}

/** Mobile supplies clock and extension facts. Shared owns all prompt policy. */
export function mobileToolPromptMessages(
  messages: Message[],
  enabledToolIds: string[],
  hasTools: boolean,
): Message[] {
  const active = activeMobileRoute('text').model;
  const nativeToolCalling = !!active?.capabilities.tools;
  const extensionHints = nativeToolCalling
    ? ''
    : getToolExtensions()
        .map(extension => extension.getSystemPromptHint())
        .filter(Boolean)
        .join('');
  const clock = deviceClockFacts();
  const result = prepareToolPromptMessages(messages, {
    enabledToolIds,
    hasTools,
    nativeToolCalling,
    extensionHints,
    now: new Date(),
    ...clock,
  }) as Message[];
  if (hasTools) {
    logger.log(
      `[SharedTools] prepared tool prompt with ${enabledToolIds.length} enabled tools`,
    );
  }
  return result;
}
