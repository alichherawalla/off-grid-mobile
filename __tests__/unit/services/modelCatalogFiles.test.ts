import {
  catalogModelFiles,
  resolveModelFiles,
} from '../../../src/services/modelCatalogFiles';
import type { ModelEntry } from '@offgrid/models';

describe('modelCatalogFiles', () => {
  it('projects the Shared Gemma entry with its primary and projector artifacts', () => {
    const files = catalogModelFiles('unsloth/gemma-4-E2B-it-GGUF');

    expect(files).toEqual([
      expect.objectContaining({
        name: 'gemma-4-E2B-it-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        downloadUrl: expect.stringContaining(
          '/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
        ),
        mmProjFile: expect.objectContaining({
          name: 'mmproj-gemma-4-E2B-it-F16.gguf',
          downloadUrl: expect.stringContaining(
            '/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-F16.gguf',
          ),
        }),
      }),
    ]);
  });

  it('does not call network discovery for a catalog-owned model', async () => {
    const discovery = { getModelFiles: jest.fn() };

    const files = await resolveModelFiles(
      'unsloth/gemma-4-E2B-it-GGUF',
      discovery,
    );

    expect(files[0]?.name).toBe('gemma-4-E2B-it-Q4_K_M.gguf');
    expect(discovery.getModelFiles).not.toHaveBeenCalled();
  });

  it('uses network discovery for an uncatalogued model', async () => {
    const discoveredFile = {
      name: 'custom-Q4_K_M.gguf',
      size: 100,
      quantization: 'Q4_K_M',
      downloadUrl: 'https://example.test/custom-Q4_K_M.gguf',
    };
    const discovery = {
      getModelFiles: jest.fn().mockResolvedValue([discoveredFile]),
    };

    await expect(
      resolveModelFiles('community/custom-GGUF', discovery),
    ).resolves.toEqual([discoveredFile]);
    expect(discovery.getModelFiles).toHaveBeenCalledWith(
      'community/custom-GGUF',
    );
  });

  it('does not discover files for a catalog-owned runtime model', async () => {
    const catalog: ModelEntry[] = [
      {
        id: 'runtime/model',
        name: 'Runtime Model',
        kind: 'voice',
        artifactDelivery: 'runtime',
        files: [],
      },
    ];

    expect(catalogModelFiles('runtime/model', catalog)).toEqual([]);
  });
});
