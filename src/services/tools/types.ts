import type {
  SharedToolCall,
  SharedToolErrorCategory,
  SharedToolResult,
  ToolCatalogEntry,
} from '@offgrid/models';

/** Mobile presentation metadata is the shared catalog contract. */
export type ToolDefinition = ToolCatalogEntry & { icon: string };

export interface ToolCall extends Omit<SharedToolCall, 'arguments'> {
  arguments: Record<string, any>;
  context?: {
    conversationId?: string;
    projectId?: string;
  };
}

export type ToolErrorCategory = SharedToolErrorCategory;
export type ToolResult = SharedToolResult;
