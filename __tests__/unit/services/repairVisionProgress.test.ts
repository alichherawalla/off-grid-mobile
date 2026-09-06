import type {ModelsEvent, RepairProjectorCommand} from '@offgrid/application';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../harness/nativeBoundary';

const MODEL_ID = 'test/model/vision-Q4_K_M.gguf';
const MODEL_NAME = 'vision-Q4_K_M.gguf';
const PROJECTOR_NAME = 'mmproj-model-f16.gguf';
const PROJECTOR_SIZE = 900_000_000;
const OPERATION_ID = 'repair-vision-progress';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

const command = (): RepairProjectorCommand => ({
  operationId: OPERATION_ID,
  modelId: MODEL_ID,
  primary: {fileName: MODEL_NAME, localName: `models/${MODEL_NAME}`},
  projector: {
    fileName: PROJECTOR_NAME,
    url: `https://huggingface.co/test/model/resolve/main/${PROJECTOR_NAME}`,
    totalBytes: PROJECTOR_SIZE,
  },
});

async function startRepairBoundary() {
  const boundary = installNativeBoundary({download: true, fs: true});
  boundary.fs!.seedFile(`/docs/models/${MODEL_NAME}`, 4_000_000_000);
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.setItem('@local_llm/downloaded_models', JSON.stringify([{
    id: MODEL_ID,
    name: 'Vision model',
    author: 'test',
    filePath: `/docs/models/${MODEL_NAME}`,
    fileName: MODEL_NAME,
    fileSize: 4_000_000_000,
    quantization: 'Q4_K_M',
    downloadedAt: '2026-09-04T00:00:00.000Z',
    engine: 'llama',
    isVisionModel: true,
    mmProjFileName: PROJECTOR_NAME,
  }]));
  const {startMobileApplicationFixture} = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
  return boundary;
}

async function waitForTransferStart(boundary: ReturnType<typeof installNativeBoundary>) {
  for (let turn = 0; turn < 20 && boundary.download!.module.startDownload.mock.calls.length === 0; turn += 1) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(boundary.download!.module.startDownload).toHaveBeenCalledTimes(1);
  return boundary.download!.active()[0].downloadId;
}

describe('Shared projector repair progress', () => {
  it('publishes determinate progress incrementally from zero through mid-transfer', async () => {
    const boundary = await startRepairBoundary();
    const events: ModelsEvent[] = [];
    const release = fixture!.application.models.events(event => events.push(event));
    const repair = fixture!.application.models.repairProjector(command());
    const transferId = await waitForTransferStart(boundary);

    const progress = () => events.filter((event): event is Extract<ModelsEvent, {type: 'model_projector_repair_progress'}> =>
      event.type === 'model_projector_repair_progress');
    expect(progress()).toEqual([]);

    boundary.download!.events.emit('DownloadProgress', {
      downloadId: transferId,
      bytesDownloaded: PROJECTOR_SIZE / 2,
      totalBytes: PROJECTOR_SIZE,
    });
    expect(progress().at(-1)).toEqual(expect.objectContaining({
      operationId: OPERATION_ID,
      bytesDownloaded: PROJECTOR_SIZE / 2,
      totalBytes: PROJECTOR_SIZE,
    }));

    boundary.download!.events.emit('DownloadProgress', {
      downloadId: transferId,
      bytesDownloaded: PROJECTOR_SIZE * 0.9,
      totalBytes: PROJECTOR_SIZE,
    });
    expect(progress().at(-1)!.bytesDownloaded).toBeGreaterThan(progress()[0].bytesDownloaded);

    boundary.fs!.seedFile(`/docs/offgrid-download-staging/projector-repair/${OPERATION_ID}/${PROJECTOR_NAME}`, PROJECTOR_SIZE);
    boundary.download!.events.emit('DownloadComplete', {downloadId: transferId});
    const outcome = await repair;
    expect(outcome.ok).toBe(true);
    release();
  });

  it('publishes failure and returns a typed failure when the transfer errors', async () => {
    const boundary = await startRepairBoundary();
    const events: ModelsEvent[] = [];
    const release = fixture!.application.models.events(event => events.push(event));
    const repair = fixture!.application.models.repairProjector(command());
    const transferId = await waitForTransferStart(boundary);

    boundary.download!.events.emit('DownloadError', {
      downloadId: transferId,
      reason: 'Network error',
    });
    const outcome = await repair;
    expect(outcome).toEqual(expect.objectContaining({ok: false}));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'model_projector_repair_failed',
      operationId: OPERATION_ID,
      failure: expect.objectContaining({message: 'Network error'}),
    }));
    release();
  });
});
