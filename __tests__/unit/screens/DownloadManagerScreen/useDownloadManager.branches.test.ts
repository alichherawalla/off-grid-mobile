import type { ModelsSnapshot } from '@offgrid/application';
import { facadeDownloadToActiveItem } from '../../../../src/screens/DownloadManagerScreen/downloadItemMapping';

type DownloadRow = ModelsSnapshot['control']['downloads'][number];

function row(overrides: Partial<DownloadRow> = {}): DownloadRow {
  return {
    downloadId: 'download-1',
    modelKey: 'org/repo/model-q4.gguf',
    modelId: 'org/repo',
    fileName: 'model-q4.gguf',
    modelType: 'text',
    status: 'downloading',
    bytesDownloaded: 25,
    totalBytes: 100,
    ...overrides,
  } as DownloadRow;
}

describe('Download Manager public download projection', () => {
  it('maps measured text progress without changing the public download identity', () => {
    expect(facadeDownloadToActiveItem(row())).toEqual(
      expect.objectContaining({
        type: 'active',
        downloadId: 'download-1',
        modelKey: 'org/repo/model-q4.gguf',
        modelId: 'org/repo',
        author: 'org',
        progress: 0.25,
        status: 'downloading',
      }),
    );
  });

  it('does not trust incomplete image metadata as display data', () => {
    expect(
      facadeDownloadToActiveItem(
        row({
          modelKey: 'image:sd',
          modelId: 'sd',
          modelType: 'image',
          metadataJson: JSON.stringify({
            imageModelName: 'Stable Diffusion',
            imageModelBackend: 'coreml',
          }),
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        modelId: 'sd',
        fileName: 'model-q4.gguf',
        author: 'sd',
        quantization: '',
      }),
    );
  });

  it('does not invent progress when the transfer total is not known', () => {
    expect(
      facadeDownloadToActiveItem(
        row({ status: 'preparing', bytesDownloaded: 0, totalBytes: 0 }),
      ).progress,
    ).toBe(0);
  });

  it('rejects an invalid model type instead of rendering a false row', () => {
    expect(() =>
      facadeDownloadToActiveItem(
        row({ modelType: 'embedding' } as unknown as Partial<DownloadRow>),
      ),
    ).toThrow('Download has an invalid model type: embedding');
  });
});
