import type { ONNXImageModel } from '../../../../src/types';
import {
  imageModelTransferBlocker,
  imageModelPathBlocker,
  transferredImageDescriptor,
  transferredImageManifest,
} from '../../../../src/services/modelManager/imageTransfer';

function imageModel(backend: ONNXImageModel['backend']): ONNXImageModel {
  return {
    id: `model-${backend}`,
    name: `Model ${backend}`,
    description: 'Transferred model',
    modelPath: `/docs/image_models/model-${backend}`,
    downloadedAt: '2026-08-20T00:00:00.000Z',
    size: 1_500_000_000,
    backend,
    style: 'cinematic',
    attentionVariant: 'original',
  };
}

describe('image model transfer contract', () => {
  it('describes an iOS Core ML archive with its exact runtime and registry metadata', () => {
    const manifest = transferredImageManifest(
      imageModel('coreml'),
      'ios',
      1_100_000_000,
    );

    expect(manifest).toEqual(
      expect.objectContaining({
        id: 'model-coreml',
        kind: 'image',
        engine: 'coreml',
        platform: 'ios',
        files: [
          expect.objectContaining({
            name: 'model-coreml.offgrid-image.zip',
            sizeBytes: 1_100_000_000,
            role: 'primary',
          }),
        ],
      }),
    );
    expect(transferredImageDescriptor(manifest, 'ios')).toEqual({
      version: 1,
      backend: 'coreml',
      description: 'Transferred model',
      uncompressedSizeBytes: 1_500_000_000,
      style: 'cinematic',
      attentionVariant: 'original',
    });
  });

  it('describes an Android LocalDream MNN archive', () => {
    const manifest = transferredImageManifest(
      imageModel('mnn'),
      'android',
      1_200_000_000,
    );

    expect(manifest.engine).toBe('localdream-mnn');
    expect(manifest.platform).toBe('android');
    expect(transferredImageDescriptor(manifest, 'android').backend).toBe('mnn');
  });

  it('rejects cross-runtime packages and QNN packages with clear reasons', () => {
    const ios = transferredImageManifest(
      imageModel('coreml'),
      'ios',
      1_100_000_000,
    );
    expect(() => transferredImageDescriptor(ios, 'android')).toThrow(
      'requires an Android LocalDream MNN image model package',
    );
    expect(imageModelTransferBlocker(imageModel('qnn'), 'android')).toBe(
      'QNN image models are tied to a specific Qualcomm target and cannot be sent safely',
    );
  });

  it('rejects an archive whose descriptor does not match its declared engine', () => {
    const manifest = transferredImageManifest(
      imageModel('coreml'),
      'ios',
      1_100_000_000,
    );
    const changed = {
      ...manifest,
      image: { ...manifest.image, backend: 'mnn' },
    };
    expect(() => transferredImageDescriptor(changed, 'ios')).toThrow(
      'descriptor is invalid',
    );
  });

  it('allows only the dedicated model directory or one of its descendants', () => {
    const model = imageModel('coreml');
    expect(imageModelPathBlocker(model, '/docs/image_models')).toBeNull();
    expect(
      imageModelPathBlocker(
        { ...model, modelPath: `${model.modelPath}/compiled` },
        '/docs/image_models',
      ),
    ).toBeNull();
    expect(
      imageModelPathBlocker(
        { ...model, modelPath: '/docs/image_models' },
        '/docs/image_models',
      ),
    ).toBe('the image model is outside its dedicated app model directory');
    expect(
      imageModelPathBlocker(
        { ...model, modelPath: '/docs/image_models/model-sibling' },
        '/docs/image_models',
      ),
    ).toBe('the image model is outside its dedicated app model directory');
    expect(
      imageModelPathBlocker(
        {
          ...model,
          modelPath: '/docs/image_models/model-coreml/../model-sibling',
        },
        '/docs/image_models',
      ),
    ).toBe('the image model path contains traversal segments');
  });
});
