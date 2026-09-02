import type {
  GenerationEvents,
  GenerationRequest,
  GenerationResult,
} from '@offgrid/models';
import {
  mobileGenerationService,
  refreshMobileModelServices,
} from './index';

/** Application boundary for a Mobile text/vision chat generation. */
export async function generateMobileChat(
  request: GenerationRequest,
  events: GenerationEvents,
): Promise<GenerationResult> {
  await refreshMobileModelServices();
  return mobileGenerationService.generate(request, events);
}
