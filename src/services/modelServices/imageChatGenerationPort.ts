import { imageGenerationService } from '../imageGenerationService';
import { localDreamGeneratorService } from '../localDreamGenerator';
import { contextCompactionService } from '../contextCompaction';

/** Chat adapter boundary around Mobile's image generation use case. */
export const mobileImageChatGeneration = {
  generate: imageGenerationService.generateImage.bind(imageGenerationService),
  /** The reason the last generate() returned null; the turn shows this, not a generic line. */
  lastError: () => imageGenerationService.getState().error,
  cancel: imageGenerationService.cancelGeneration.bind(imageGenerationService),
  isGenerating: () => imageGenerationService.getState().isGenerating,
  deleteArtifact: (id: string) => localDreamGeneratorService.deleteGeneratedImage(id),
  clearConversationSummary: (conversationId: string) => {
    contextCompactionService.clearSummary(conversationId);
  },
};
