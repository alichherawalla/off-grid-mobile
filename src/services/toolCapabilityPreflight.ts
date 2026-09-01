import { toolCapabilityIssue } from '@offgrid/models';
import { activeMobileModel } from './modelServices';

export const REMOTE_TOOLS_UNAVAILABLE =
  'This remote model cannot run tools from Chat. Select a model with tool support, or use it as the Computer Use specialist.';

/** One preflight before a turn enters the tool loop. Providers remain transport adapters. */
export function remoteToolCapabilityIssue(
  requestedToolCount: number,
): string | undefined {
  if (requestedToolCount === 0) return undefined;
  const model = activeMobileModel('text').model;
  if (model?.source !== 'remote') return undefined;
  const issue = toolCapabilityIssue(
    requestedToolCount,
    model ? { toolCalling: model.capabilities.tools } : undefined,
  );
  return issue ? REMOTE_TOOLS_UNAVAILABLE : undefined;
}
