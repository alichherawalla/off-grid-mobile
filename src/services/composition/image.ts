// Composition root: the shared image generation application over Mobile's image ports.
import { ImageGenerationApplicationService } from '@offgrid/models';
import { mobileImageGenerationApplicationPorts } from '../modelServices/imageGenerationApplication';
import { mobileWorkspace } from '../modelServices/workspace';
import { once } from './once';

export const imageGenerationApplication = once(
  () => new ImageGenerationApplicationService(mobileWorkspace.llm, mobileImageGenerationApplicationPorts()),
);
