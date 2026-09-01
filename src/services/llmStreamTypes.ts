/**
 * Streaming token shape emitted by the llama engine. Lives in its own module so consumers
 * Native generation adapters import it without importing llm.ts, which keeps
 * the engine boundary free of circular dependencies.
 */
export type StreamToken = { content?: string; reasoningContent?: string };
export type StreamCallback = (data: StreamToken) => void;
export type CompleteCallback = (result: { content: string; reasoningContent: string }) => void;
