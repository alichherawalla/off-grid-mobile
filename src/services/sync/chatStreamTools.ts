import {
  completeChatStreamTool,
  startChatStreamTool,
  type ChatStreamTool,
} from '@offgrid/sync';
import type { Message } from '../../types';

/** Fold Mobile's persisted tool-call/result rows into the portable live stream record. */
export function chatStreamToolsFromMessages(
  messages: readonly Message[],
): ChatStreamTool[] | undefined {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  const turn = messages.slice(lastUserIndex + 1);
  let tools: ChatStreamTool[] = [];

  for (const message of turn) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        tools = startChatStreamTool(tools, call.name);
      }
      continue;
    }
    if (message.role === 'tool' && message.toolName) {
      tools = completeChatStreamTool(tools, message.toolName, message.content);
    }
  }

  return tools.length > 0 ? tools : undefined;
}
