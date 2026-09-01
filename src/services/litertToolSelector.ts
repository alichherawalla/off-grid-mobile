import {
  selectRelevantToolsWithModel,
  type SelectableToolSchema,
  type ToolSelectionGenerate,
} from '@offgrid/models';
export type ToolSelectGenerate = ToolSelectionGenerate;

/** Shared owns prompt and parsing policy; the caller supplies the shared generation use case. */
export function selectRelevantTools(
  userText: string,
  tools: SelectableToolSchema[],
  generate: ToolSelectGenerate,
): Promise<string[] | null> {
  return selectRelevantToolsWithModel(userText, tools, generate);
}
