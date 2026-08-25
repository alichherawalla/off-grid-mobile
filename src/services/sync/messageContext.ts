import {
  projectSyncedMessageTurn,
  serializeSyncedMessageContext,
  type SyncedRetrievalSource,
  type SyncedToolArtifact,
  type SyncedMessageTurnInput,
  type SyncedMessageTurnProjection,
} from '@offgrid/sync';
import type { Message } from '../../types';

const RETRIEVAL_TOOL_ARTIFACT_ID = 'offgrid:retrieval-sources';

/** Feed durable retrieval evidence into the existing tool-result accordion. */
export function retrievalToolArtifact(
  sources?: readonly SyncedRetrievalSource[],
): SyncedToolArtifact | undefined {
  if (!sources?.length) return undefined;
  const count = sources.length;
  return {
    id: RETRIEVAL_TOOL_ARTIFACT_ID,
    name: `Searched your memory — ${count} result${count === 1 ? '' : 's'}`,
    result: sources
      .map(source => `${source.name} — ${Math.round(source.score * 100)}%`)
      .join('\n\n'),
    status: 'completed',
  };
}

/** Serialize only the shared, peer-safe part of a persisted message context. */
export function serializeMessageContext(
  message: Pick<
    Message,
    | 'role'
    | 'reasoningContent'
    | 'toolArtifacts'
    | 'toolCallId'
    | 'toolName'
    | 'generationTimeMs'
    | 'generationMeta'
    | 'isSystemInfo'
    | 'actionApproval'
  >,
): string | null {
  return serializeSyncedMessageContext({
    actionApproval: message.actionApproval,
    reasoning: message.reasoningContent,
    // "Model loaded: …" is the app talking, not the model. Only the device that wrote it knows
    // that, so it travels: without it the peer sees a plain assistant turn and draws a bubble,
    // and the same conversation reads differently on each device.
    notice: message.isSystemInfo,
    // Which tools this turn was GIVEN, not just the ones it called: a reply that had three tools and
    // used none is a different fact, and it is only known on the device that generated it.
    toolsOffered: message.generationMeta?.routedToolNames,
    toolCalls: message.toolArtifacts?.filter(
      artifact => artifact.id !== RETRIEVAL_TOOL_ARTIFACT_ID,
    ),
    ...(message.role === 'tool'
      ? {
          tool: {
            callId: message.toolCallId,
            name: message.toolName,
            status: 'completed',
            durationMs: message.generationTimeMs,
          },
        }
      : {}),
    ...(message.generationTimeMs !== undefined
      ? { durationMs: message.generationTimeMs }
      : {}),
    status: 'completed',
  });
}

/** Admit peer-controlled context through the shared cross-host contract. */
/** Project a peer-controlled row into the one cross-host message-turn model. */
export function projectMessageTurn(
  input: SyncedMessageTurnInput,
): SyncedMessageTurnProjection | null {
  return projectSyncedMessageTurn(input);
}
