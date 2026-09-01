import type { Message } from '../../types';
import logger from '../../utils/logger';
import { getActiveEngineService, isRemoteTextModelActive } from '../engines';
import { liteRTService } from '../litert';
import { llmService } from '../llm';
import { getToolExtensions } from '../tools/extensions';

const TOOL_BEHAVIOR_GUIDANCE =
  '\n\nMake good use of the tools available to you. If you are uncertain or lack current information, use the appropriate tool rather than guessing. Never refuse or say you cannot help when a tool is available. For multiple distinct items, make a separate tool call for each. Call tools silently — do not announce them first. To find or look up content, prefer a general search tool before a specialized query tool. If a tool returns an error, try a different suitable tool before giving up.';
const TIME_SENSITIVE_TOOL_IDS = ['create_calendar_event', 'read_calendar_events'];

function currentTimeParts() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  try {
    return {
      date,
      time,
      day: now.toLocaleDateString(undefined, { weekday: 'long' }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    };
  } catch {
    return { date, time, day: '', timezone: '' };
  }
}

export function mobileToolPromptMessages(
  messages: Message[],
  enabledToolIds: string[],
  hasTools: boolean,
): Message[] {
  if (!hasTools) return messages;
  const systemIndex = messages.findIndex(message => message.role === 'system');
  if (systemIndex < 0) return messages;
  const nativeTools = getActiveEngineService() === liteRTService
    || isRemoteTextModelActive()
    || llmService.supportsToolCalling();
  const extensionHints = nativeTools
    ? ''
    : getToolExtensions().map(extension => extension.getSystemPromptHint()).filter(Boolean).join('');
  const parts = currentTimeParts();
  const day = parts.day ? ` Today is ${parts.day}.` : '';
  const timezone = parts.timezone ? ` Timezone: ${parts.timezone}.` : '';
  const output = messages.map(message => ({ ...message }));
  const system = output[systemIndex];
  system.content = `${typeof system.content === 'string' ? system.content : ''}${TOOL_BEHAVIOR_GUIDANCE}\n\nThe current date is ${parts.date} (device local date, format YYYY-MM-DD).${day}${timezone} Resolve relative dates against this date.${extensionHints}`;
  if (enabledToolIds.some(id => TIME_SENSITIVE_TOOL_IDS.includes(id))) {
    for (let index = output.length - 1; index >= 0; index -= 1) {
      if (output[index].role !== 'user' || typeof output[index].content !== 'string') continue;
      const zone = parts.timezone ? `, ${parts.timezone}` : '';
      output[index].content += `\n\n(Current local date and time: ${parts.date}T${parts.time}${zone}. Use this only to resolve relative times.)`;
      break;
    }
  }
  logger.log(`[SharedTools] prepared tool prompt with ${enabledToolIds.length} enabled tools`);
  return output;
}
