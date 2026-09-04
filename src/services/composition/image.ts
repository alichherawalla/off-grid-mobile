// Composition root: the shared image generation application over Mobile's image ports.
import { once } from '@offgrid/models';
import { mobileImageGenerationApplicationPorts } from '../modelServices/imageGenerationApplication';
import { mobileWorkspace } from '../modelServices/workspace';

export const imageGenerationApplication = once(
  () => mobileWorkspace.imageApplication(mobileImageGenerationApplicationPorts()),
);
