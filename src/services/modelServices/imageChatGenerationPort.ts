import { imageGenerationService } from '../imageGenerationService';

/** Chat adapter boundary around Mobile's image generation use case. */
export const mobileImageChatGeneration = {
  generate: imageGenerationService.generateImage.bind(imageGenerationService),
  cancel: imageGenerationService.cancelGeneration.bind(imageGenerationService),
};
