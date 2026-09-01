import {
  selectRelevantToolsWithModel,
  type SelectableToolSchema,
  type ToolSelectionGenerate,
} from '@offgrid/models';
import { liteRTService } from './litert';

export type ToolSelectGenerate = ToolSelectionGenerate;

/** Mobile supplies the LiteRT generation boundary. Shared owns prompt and parsing policy. */
export function selectRelevantTools(
  userText: string,
  tools: SelectableToolSchema[],
  generate: ToolSelectGenerate = (system, user) =>
    liteRTService.generateToolSelection(system, user),
): Promise<string[] | null> {
  return selectRelevantToolsWithModel(userText, tools, generate);
}
