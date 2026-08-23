/**
 * What a finished reply leaves behind.
 *
 * Pure, and separate from the store, because it answers a question the store only holds the inputs
 * for: given what streamed, is there a durable message to write - and therefore a record a paired
 * device should wait for? Stop the model mid-thought and the answer is no, which is the difference
 * between a peer retiring its preview and sitting on "Thinking..." until it expires.
 */
import { parseModelOutput } from '../utils/messageContent';

/**
 * How the reply that just ended finished, for whoever has to tell the other devices.
 *
 * A peer keeps a finished reply on screen until its durable record lands, which is right when a
 * record IS coming and wrong when it is not: stop the model while it is still thinking and the
 * empty stream is dropped, so nothing is ever stored and the peer sits on "Thinking..." until the
 * expiry window. Only the store knows which of the two happened, so it says.
 */
export interface ReplyEnd {
  conversationId: string;
  persisted: boolean;
}

/** What the live-stream service reads to describe this device's reply to its peers. */
export interface StreamingSnapshot {
  conversationId: string | null;
  /** The id this reply will be persisted under, so a peer can match it to the record. */
  messageId: string | null;
  content: string;
  reasoningContent: string;
  isStreaming: boolean;
  isThinking: boolean;
  isModelLoading: boolean;
  loadingModelName: string | null;
}

export interface StreamedReply {
  streamingMessage: string;
  streamingReasoningContent: string;
  /** The conversation the stream belongs to, which must match the one being finalized. */
  streamingForConversationId: string | null;
  conversationId: string;
}

export interface FinalizedReply {
  /** True when there is something to store, and so a record for peers to expect. */
  persisted: boolean;
  content: string;
  reasoningContent?: string;
}

export function finalizeStreamedReply(reply: StreamedReply): FinalizedReply {
  // Parsed ONCE at this boundary through the single shared parser: the raw stream is split into
  // reasoning and a clean answer, stripped of control and tool-call markup by construction, so no
  // raw markup can reach the stored message and no renderer downstream re-parses it.
  const streamReasoning = reply.streamingReasoningContent.trim() || undefined;
  const parsed = parseModelOutput(reply.streamingMessage, streamReasoning);
  const reasoningContent = parsed.reasoning ?? undefined;
  const content = parsed.answer;
  const persisted = Boolean(
    reply.streamingForConversationId === reply.conversationId &&
      (content || reasoningContent),
  );
  return { persisted, content, ...(reasoningContent ? { reasoningContent } : {}) };
}
