/**
 * Service-level entry point for image-model downloads. Both model setup surfaces call this owner.
 * The existing pipeline remains unchanged while its large native finalization unit is extracted.
 */
export { handleDownloadImageModel as startImageModelDownload } from '../screens/ModelsScreen/imageDownloadActions';
export type { ImageDownloadDeps } from '../screens/ModelsScreen/types';
