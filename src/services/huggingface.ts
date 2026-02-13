import { HFModelSearchResult, ModelInfo, ModelFile, ModelCredibility } from '../types';
import { HF_API, QUANTIZATION_INFO, LMSTUDIO_AUTHORS, OFFICIAL_MODEL_AUTHORS, VERIFIED_QUANTIZERS } from '../constants';

class HuggingFaceService {
  private baseUrl = HF_API.baseUrl;
  private apiUrl = HF_API.apiUrl;

  async searchModels(
    query: string = '',
    options: {
      limit?: number;
      sort?: string;
      direction?: string;
    } = {}
  ): Promise<ModelInfo[]> {
    const { limit = 30, sort = 'downloads', direction = '-1' } = options;

    try {
      const params = new URLSearchParams({
        filter: 'gguf',
        sort,
        direction,
        limit: limit.toString(),
      });

      if (query) {
        params.append('search', query);
      }

      const response = await fetch(
        `${this.apiUrl}/models?${params.toString()}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const results: HFModelSearchResult[] = await response.json();

      // Transform to our ModelInfo format
      return results.map(this.transformModelResult);
    } catch (error) {
      console.error('Error searching models:', error);
      throw error;
    }
  }

  async getModelDetails(modelId: string): Promise<ModelInfo> {
    try {
      const response = await fetch(
        `${this.apiUrl}/models/${modelId}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result: HFModelSearchResult = await response.json();
      return this.transformModelResult(result);
    } catch (error) {
      console.error('Error fetching model details:', error);
      throw error;
    }
  }

  async getModelFiles(modelId: string): Promise<ModelFile[]> {
    try {
      // Use the tree endpoint which includes file sizes
      const response = await fetch(
        `${this.apiUrl}/models/${modelId}/tree/main`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        // Fallback to basic model endpoint if tree fails
        return this.getModelFilesFromSiblings(modelId);
      }

      const files: Array<{
        type: string;
        path: string;
        size?: number;
        lfs?: { size: number };
      }> = await response.json();

      // Filter for GGUF files
      const allGguf = files.filter(file => file.type === 'file' && file.path.endsWith('.gguf'));

      // Separate mmproj files from model files
      const mmProjFiles = allGguf.filter(f => this.isMMProjFile(f.path));
      const modelFiles = allGguf.filter(f => !this.isMMProjFile(f.path));

      console.log('[HuggingFace] Found GGUF files:', allGguf.map(f => f.path));
      console.log('[HuggingFace] MMProj files:', mmProjFiles.map(f => f.path));
      console.log('[HuggingFace] Model files:', modelFiles.map(f => f.path));

      // Transform and pair each model file with its matching mmproj
      const result = modelFiles
        .map(file => {
          const mmProjFile = this.findMatchingMMProj(file.path, mmProjFiles, modelId);
          console.log('[HuggingFace] Pairing', file.path, '→ mmproj:', mmProjFile?.name || 'NONE');
          return {
            name: file.path,
            size: file.lfs?.size || file.size || 0,
            quantization: this.extractQuantization(file.path),
            downloadUrl: this.getDownloadUrl(modelId, file.path),
            mmProjFile,
          };
        })
        .sort((a, b) => a.size - b.size);

      return result;
    } catch (error) {
      console.error('Error fetching model files:', error);
      // Fallback to siblings method
      return this.getModelFilesFromSiblings(modelId);
    }
  }

  private async getModelFilesFromSiblings(modelId: string): Promise<ModelFile[]> {
    try {
      const response = await fetch(
        `${this.apiUrl}/models/${modelId}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result: HFModelSearchResult = await response.json();

      if (!result.siblings) {
        return [];
      }

      // Filter for GGUF files
      const allGguf = result.siblings.filter(file => file.rfilename.endsWith('.gguf'));

      // Separate mmproj files from model files
      const mmProjFiles = allGguf.filter(f => this.isMMProjFile(f.rfilename));
      const modelFiles = allGguf.filter(f => !this.isMMProjFile(f.rfilename));

      // Convert mmproj files to the format expected by findMatchingMMProj
      const mmProjFilesForMatching = mmProjFiles.map(f => ({
        path: f.rfilename,
        size: f.size,
        lfs: f.lfs,
      }));

      // Transform and pair each model file with its matching mmproj
      return modelFiles
        .map(file => {
          const baseFile = this.transformFileInfo(modelId, file);
          const mmProjFile = this.findMatchingMMProj(file.rfilename, mmProjFilesForMatching, modelId);
          return {
            ...baseFile,
            mmProjFile,
          };
        })
        .sort((a, b) => a.size - b.size);
    } catch (error) {
      console.error('Error fetching model files from siblings:', error);
      throw error;
    }
  }

  getDownloadUrl(modelId: string, fileName: string, revision: string = 'main'): string {
    return `${this.baseUrl}/${modelId}/resolve/${revision}/${fileName}`;
  }

  private determineCredibility(author: string): ModelCredibility {
    // Check if from LM Studio community (highest credibility for GGUF)
    if (LMSTUDIO_AUTHORS.includes(author)) {
      return {
        source: 'lmstudio',
        isOfficial: false,
        isVerifiedQuantizer: true,
        verifiedBy: 'LM Studio',
      };
    }

    // Check if from official model creator
    if (OFFICIAL_MODEL_AUTHORS[author]) {
      return {
        source: 'official',
        isOfficial: true,
        isVerifiedQuantizer: false,
        verifiedBy: OFFICIAL_MODEL_AUTHORS[author],
      };
    }

    // Check if from verified quantizer
    if (VERIFIED_QUANTIZERS[author]) {
      return {
        source: 'verified-quantizer',
        isOfficial: false,
        isVerifiedQuantizer: true,
        verifiedBy: VERIFIED_QUANTIZERS[author],
      };
    }

    // Community/unknown source
    return {
      source: 'community',
      isOfficial: false,
      isVerifiedQuantizer: false,
    };
  }

  private transformModelResult = (result: HFModelSearchResult): ModelInfo => {
    const files = result.siblings
      ?.filter(file => file.rfilename.endsWith('.gguf'))
      .map(file => this.transformFileInfo(result.id, file)) || [];

    const author = result.author || result.id.split('/')[0] || 'Unknown';
    const credibility = this.determineCredibility(author);

    return {
      id: result.id,
      name: result.id.split('/').pop() || result.id,
      author,
      description: this.extractDescription(result),
      downloads: result.downloads || 0,
      likes: result.likes || 0,
      tags: result.tags || [],
      lastModified: result.lastModified,
      files,
      credibility,
    };
  };

  private transformFileInfo(modelId: string, file: { rfilename: string; size?: number; lfs?: { size: number } }): ModelFile {
    const fileName = file.rfilename;
    const size = file.lfs?.size || file.size || 0;
    const quantization = this.extractQuantization(fileName);

    return {
      name: fileName,
      size,
      quantization,
      downloadUrl: this.getDownloadUrl(modelId, fileName),
    };
  }

  private extractQuantization(fileName: string): string {
    const upperName = fileName.toUpperCase();

    // Check for known quantization patterns
    for (const quant of Object.keys(QUANTIZATION_INFO)) {
      if (upperName.includes(quant.replace('_', ''))) {
        return quant;
      }
      if (upperName.includes(quant)) {
        return quant;
      }
    }

    // Try to extract with regex
    const match = fileName.match(/[QqFf]\d+[_]?[KkMmSs]*/);
    if (match) {
      return match[0].toUpperCase();
    }

    return 'Unknown';
  }

  private isMMProjFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return lower.includes('mmproj') ||
           lower.includes('projector') ||
           (lower.includes('clip') && lower.endsWith('.gguf'));
  }

  private findMatchingMMProj(
    modelFileName: string,
    mmProjFiles: Array<{ path: string; size?: number; lfs?: { size: number } }>,
    modelId: string
  ): { name: string; size: number; downloadUrl: string } | undefined {
    if (mmProjFiles.length === 0) {
      return undefined;
    }

    // modelQuant intentionally unused; matching is done via modelLower below
    const modelLower = modelFileName.toLowerCase();

    // Try to match by quantization level
    for (const mmProj of mmProjFiles) {
      const mmProjQuant = this.extractQuantization(mmProj.path);
      // Match exact quantization or if model uses the mmproj's quantization variant
      if (mmProjQuant !== 'Unknown' && modelLower.includes(mmProjQuant.toLowerCase())) {
        return {
          name: mmProj.path,
          size: mmProj.lfs?.size || mmProj.size || 0,
          downloadUrl: this.getDownloadUrl(modelId, mmProj.path),
        };
      }
    }

    // Fallback: prefer f16 mmproj if available, otherwise use the first one
    const f16MMProj = mmProjFiles.find(f => {
      const lower = f.path.toLowerCase();
      return lower.includes('f16') || lower.includes('fp16');
    });

    const selectedMMProj = f16MMProj || mmProjFiles[0];
    return {
      name: selectedMMProj.path,
      size: selectedMMProj.lfs?.size || selectedMMProj.size || 0,
      downloadUrl: this.getDownloadUrl(modelId, selectedMMProj.path),
    };
  }

  private extractDescription(result: HFModelSearchResult): string {
    // Try to get description from card data or tags
    if (result.cardData?.pipeline_tag) {
      return `${result.cardData.pipeline_tag} model`;
    }

    const relevantTags = result.tags?.filter(tag =>
      !tag.startsWith('license:') &&
      !tag.startsWith('language:') &&
      tag !== 'gguf'
    ).slice(0, 3);

    if (relevantTags && relevantTags.length > 0) {
      return relevantTags.join(', ');
    }

    return 'GGUF quantized model';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  getQuantizationInfo(quantization: string) {
    return QUANTIZATION_INFO[quantization] || {
      bitsPerWeight: 4.5,
      quality: 'Unknown',
      description: 'Unknown quantization level',
      recommended: false,
    };
  }

  // Image generation model search
  async searchImageGenerationModels(
    query: string = '',
    options: { limit?: number } = {}
  ): Promise<Array<{
    id: string;
    name: string;
    author: string;
    description: string;
    downloads: number;
    likes: number;
    isMediaPipeCompatible: boolean;
    modelType: string;
  }>> {
    const { limit = 20 } = options;

    try {
      // Search for diffusers/stable-diffusion models
      const params = new URLSearchParams({
        filter: 'diffusers',
        sort: 'downloads',
        direction: '-1',
        limit: limit.toString(),
      });

      if (query) {
        params.append('search', query);
      } else {
        // Default search for small/mobile-friendly SD models
        params.append('search', 'stable-diffusion small mobile');
      }

      const response = await fetch(
        `${this.apiUrl}/models?${params.toString()}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const results: HFModelSearchResult[] = await response.json();

      return results.map(result => {
        const author = result.author || result.id.split('/')[0] || 'Unknown';
        const isMediaPipe = this.isMediaPipeCompatible(result);

        return {
          id: result.id,
          name: result.id.split('/').pop() || result.id,
          author,
          description: this.extractImageModelDescription(result),
          downloads: result.downloads || 0,
          likes: result.likes || 0,
          isMediaPipeCompatible: isMediaPipe,
          modelType: this.getImageModelType(result),
        };
      });
    } catch (error) {
      console.error('Error searching image models:', error);
      throw error;
    }
  }

  private isMediaPipeCompatible(result: HFModelSearchResult): boolean {
    const tags = result.tags || [];
    const id = result.id.toLowerCase();

    // Check for MediaPipe-specific tags or known compatible models
    if (tags.includes('mediapipe') || id.includes('mediapipe')) {
      return true;
    }

    // Models known to work with MediaPipe
    const knownCompatible = [
      'runwayml/stable-diffusion-v1-5',
      'stabilityai/stable-diffusion-2-1',
      'CompVis/stable-diffusion-v1-4',
    ];

    return knownCompatible.some(known => id.includes(known.toLowerCase()));
  }

  private getImageModelType(result: HFModelSearchResult): string {
    const tags = result.tags || [];

    if (tags.includes('stable-diffusion-xl')) return 'SDXL';
    if (tags.includes('stable-diffusion')) return 'SD 1.x/2.x';
    if (tags.includes('flux')) return 'Flux';
    if (tags.includes('latent-consistency')) return 'LCM';

    return 'Diffusion';
  }

  private extractImageModelDescription(result: HFModelSearchResult): string {
    const tags = result.tags || [];

    const relevantTags = tags.filter(tag =>
      !tag.startsWith('license:') &&
      !tag.startsWith('language:') &&
      tag !== 'diffusers'
    ).slice(0, 3);

    if (relevantTags.length > 0) {
      return relevantTags.join(', ');
    }

    return 'Image generation model';
  }

  // Get known MediaPipe-compatible models (curated list)
  getKnownMediaPipeModels(): Array<{
    id: string;
    name: string;
    description: string;
    size: string;
    recommended: boolean;
  }> {
    return [
      {
        id: 'mediapipe-sd-v1-5',
        name: 'Stable Diffusion v1.5 (MediaPipe)',
        description: 'Standard SD 1.5 optimized for MediaPipe on mobile devices',
        size: '~2GB',
        recommended: true,
      },
      {
        id: 'mediapipe-sd-v2-1',
        name: 'Stable Diffusion v2.1 (MediaPipe)',
        description: 'Improved quality SD 2.1 for MediaPipe',
        size: '~3GB',
        recommended: false,
      },
    ];
  }
}

export const huggingFaceService = new HuggingFaceService();
