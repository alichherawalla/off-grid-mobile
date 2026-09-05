/**
 * BATCH 4 (Image Generation) — hardening.
 *
 * Device cases 17, 18, 19, 20, 22, 26, 30, 38 assert the OBSERVABLE image-generation
 * lifecycle: the in-progress card appears, its status transitions from an enhancing
 * phase to a generating phase, the step counter advances, a second in-flight request
 * is silently ignored, cancel mid-flight tears the card down, generation with
 * enhancement OFF never shows the enhancing phase, and both "no model" and a native
 * load failure surface an error phase rather than a silent hang.
 *
 * The integration suite asserts the DERIVED `isGenerating` boolean but never the
 * authoritative `phase` field — the single source of truth the UI projects. This suite
 * drives the REAL imageGenerationService over the REAL Shared image application, with
 * fakes ONLY at the device boundary (diffusion native, llama.rn, filesystem, RAM).
 * No Off Grid module is mocked.
 */
import {
  installNativeBoundary,
  requireRTL,
  GB,
  type NativeBoundary,
} from '../harness/nativeBoundary';
import {
  createONNXImageModel,
  createDownloadedModel,
} from '../utils/factories';
import { flushPromises } from '../utils/testHelpers';
import type { ImageGenPhase } from '../../src/services/imageGenerationService';

type Fixture =
  import('../harness/mobileApplicationFixture').MobileApplicationFixture;

let applicationFixture: Fixture | undefined;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

interface Arranged {
  boundary: NativeBoundary;
  service: typeof import('../../src/services/imageGenerationService').imageGenerationService;
  isInFlight: (p: ImageGenPhase) => boolean;
}

/**
 * Arrive at "a downloaded image model is selected" the way the app does: seed the model
 * bytes on the (in-memory) disk, boot the real application, refresh its inventory, then
 * select through the application's own route resolution. No store poking.
 */
async function arrangeImageModel(
  opts: {
    enhance?: boolean;
    withTextEngine?: boolean;
  } = {},
): Promise<Arranged> {
  const boundary = installNativeBoundary({
    fs: true,
    llama: opts.withTextEngine === true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });

  const imageModel = createONNXImageModel({
    id: 'sd',
    name: 'SD',
    modelPath: '/models/sd',
    backend: 'coreml',
  });
  boundary.fs!.seedFile('/models/sd/model.mlmodelc', 8 * 1024 * 1024);

  const downloadedModels = [] as unknown[];
  if (opts.withTextEngine) {
    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    downloadedModels.push(
      createDownloadedModel({
        id: 'llm',
        engine: 'llama',
        filePath: '/models/small.gguf',
      }),
    );
  }

  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ['@local_llm/downloaded_models', JSON.stringify(downloadedModels)],
    ['@local_llm/downloaded_image_models', JSON.stringify([imageModel])],
    [
      'local-llm-app-storage',
      JSON.stringify({
        state: {
          settings: {
            imageSteps: 8,
            imageGuidanceScale: 2,
            imageWidth: 256,
            imageHeight: 256,
            imageThreads: 4,
            enhanceImagePrompts: opts.enhance === true,
          },
        },
        version: 0,
      }),
    ],
  ]);

  const { startMobileApplicationFixture } =
    require('../harness/mobileApplicationFixture') as typeof import('../harness/mobileApplicationFixture');
  applicationFixture = await startMobileApplicationFixture();
  const React = require('react');
  const rtl = requireRTL();
  const { HomeScreen } = require('../../src/screens/HomeScreen');
  rtl.render(
    React.createElement(HomeScreen, {
      navigation: {
        navigate: () => {},
        goBack: () => {},
        setOptions: () => {},
        addListener: () => () => {},
      },
    }),
  );

  const imageRoute = await rtl.waitFor(() => {
    const route = applicationFixture!.application.models.resolveRoute(
      'image',
      'sd',
    );
    expect(route).not.toBeNull();
    return route;
  });
  const selectedImage = await applicationFixture.application.models.select({
    modality: 'image',
    modelId: imageRoute,
  });
  expect(selectedImage.ok).toBe(true);

  if (opts.withTextEngine) {
    const { hardwareService } = require('../../src/services/hardware');
    await hardwareService.refreshMemoryInfo();
    const { llmService } = require('../../src/services/llm');
    await llmService.loadModel('/models/small.gguf');
    const textRoute = applicationFixture.application.models.resolveRoute(
      'text',
      'llm',
    );
    expect(textRoute).not.toBeNull();
    const selectedText = await applicationFixture.application.models.select({
      modality: 'text',
      modelId: textRoute,
    });
    expect(selectedText.ok).toBe(true);
  }

  const {
    imageGenerationService,
    isInFlight,
  } = require('../../src/services/imageGenerationService');
  return { boundary, service: imageGenerationService, isInFlight };
}

/** Record every distinct phase the service passes through, in order. */
function trackPhases(service: Arranged['service']): {
  phases: ImageGenPhase[];
  stop: () => void;
} {
  const phases: ImageGenPhase[] = [];
  const unsub = service.subscribe(s => {
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
  });
  return { phases, stop: unsub };
}

describe('image-gen phase state machine — ordered transitions (cases 17, 18, 26)', () => {
  it('enhancement OFF: idle → loading → generating → done, never enters enhancing (case 26)', async () => {
    const { service } = await arrangeImageModel({ enhance: false });

    const { phases, stop } = trackPhases(service);
    await service.generateImage({ prompt: 'a red apple' });
    stop();

    // Starts idle (initial snapshot), never shows the enhancing phase when OFF,
    // ends at the terminal done phase.
    expect(phases[0]).toBe('idle');
    expect(phases).not.toContain('enhancing');
    expect(phases).toContain('loading');
    expect(phases).toContain('generating');
    expect(phases[phases.length - 1]).toBe('done');
    // loading must precede generating (case 18 direction, without enhancement).
    expect(phases.indexOf('loading')).toBeLessThan(
      phases.indexOf('generating'),
    );
  });

  it('enhancement ON: passes through enhancing BEFORE loading/generating (cases 17, 18)', async () => {
    const { boundary, service } = await arrangeImageModel({
      enhance: true,
      withTextEngine: true,
    });
    // The real text engine rewrites the prompt; only its native completion is scripted.
    boundary.llama!.scriptCompletion({
      text: 'an enhanced red apple, studio lighting',
    });

    const { phases, stop } = trackPhases(service);
    await service.generateImage({ prompt: 'a red apple' });
    stop();

    expect(phases).toContain('enhancing');
    expect(phases).toContain('generating');
    // enhancing must come strictly before generating (the status transition case 18).
    expect(phases.indexOf('enhancing')).toBeLessThan(
      phases.indexOf('generating'),
    );
    expect(phases[phases.length - 1]).toBe('done');
    // The ENHANCED prompt is what reached native — enhancement really ran.
    const call = boundary.diffusion.calls.generateImage[0];
    expect(String(call.prompt)).toContain('studio lighting');
  });

  it('the generating status advances the step counter toward totalSteps (case 19)', async () => {
    const { boundary, service } = await arrangeImageModel({ enhance: false });

    const steps: number[] = [];
    const unsub = service.subscribe(s => {
      if (s.progress) steps.push(s.progress.step);
    });

    // Hold native generation open, then drive the REAL LocalDreamProgress native events
    // the generator subscribes to, exactly as the diffusion sampler emits them on device.
    boundary.diffusion.holdNextGeneration();
    const run = service.generateImage({ prompt: 'apple' });
    await flushPromises();
    expect(boundary.diffusion.generationHeld()).toBe(true);

    boundary.litertEvents.emit('LocalDreamProgress', {
      step: 1,
      totalSteps: 8,
      progress: 0.125,
    });
    await flushPromises();
    boundary.litertEvents.emit('LocalDreamProgress', {
      step: 3,
      totalSteps: 8,
      progress: 0.375,
    });
    await flushPromises();

    boundary.diffusion.releaseGeneration();
    await run;
    unsub();

    expect(Math.max(...steps)).toBeGreaterThanOrEqual(3);
    // monotonic non-decreasing during the run
    const generating = steps.filter(n => n > 0);
    for (let i = 1; i < generating.length; i++)
      expect(generating[i]).toBeGreaterThanOrEqual(generating[i - 1]);
  });
});

describe('illegal transition guard — a 2nd in-flight request is ignored (case 22)', () => {
  it('does not start a second generation and leaves the first phase/progress untouched', async () => {
    const { boundary, service, isInFlight } = await arrangeImageModel({
      enhance: false,
    });

    boundary.diffusion.holdNextGeneration();
    const gen1 = service.generateImage({ prompt: 'first' });
    await flushPromises();
    boundary.litertEvents.emit('LocalDreamProgress', {
      step: 2,
      totalSteps: 8,
      progress: 0.25,
    });
    await flushPromises();

    const phaseDuring = service.getState().phase;
    const progressDuring = service.getState().progress;
    expect(isInFlight(phaseDuring)).toBe(true);

    // Second request while in-flight → returns null, native generator not called again.
    const gen2 = await service.generateImage({ prompt: 'second' });
    expect(gen2).toBeNull();
    expect(boundary.diffusion.calls.generateImage.length).toBe(1);
    // First generation's phase and progress are unchanged (no reset to step 0).
    expect(service.getState().phase).toBe(phaseDuring);
    expect(service.getState().progress).toEqual(progressDuring);

    boundary.diffusion.releaseGeneration();
    await gen1;
  });
});

describe('cancel mid-flight resets the machine to idle (case 20)', () => {
  it('transitions an in-flight generation back to idle and clears progress/prompt', async () => {
    const { boundary, service, isInFlight } = await arrangeImageModel({
      enhance: false,
    });

    boundary.diffusion.holdNextGeneration();
    const run = service.generateImage({ prompt: 'cancel me' });
    await flushPromises();
    expect(isInFlight(service.getState().phase)).toBe(true);

    await service.cancelGeneration();
    await run.catch(() => {});
    await flushPromises();

    const s = service.getState();
    expect(s.phase).toBe('idle');
    expect(isInFlight(s.phase)).toBe(false);
    expect(s.progress).toBeNull();
    expect(s.prompt).toBeNull();
    // The user's STOP reached the native sampler, not just the JS projection.
    expect(boundary.diffusion.cancelCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('no-model / load-failure surface an error phase, never a silent hang (cases 30, 38)', () => {
  it('no active image model → error phase with a clear message, generateImage returns null', async () => {
    installNativeBoundary({
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    const { startMobileApplicationFixture } =
      require('../harness/mobileApplicationFixture') as typeof import('../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture();
    await applicationFixture.refreshModels();

    const {
      imageGenerationService,
      isInFlight,
    } = require('../../src/services/imageGenerationService');
    const result = await imageGenerationService.generateImage({
      prompt: 'no model',
    });

    expect(result).toBeNull();
    const s = imageGenerationService.getState();
    expect(s.phase).toBe('error');
    expect(s.error).toContain('No image model');
    expect(isInFlight(s.phase)).toBe(false); // not hung in an in-flight phase
  });

  it('image model load failure → error phase, not stuck in loading (case 38)', async () => {
    const { boundary, service, isInFlight } = await arrangeImageModel({
      enhance: false,
    });
    // The native weights refuse to load — the device failure this case exists for.
    boundary.diffusion.module.isModelLoaded.mockResolvedValue(false);
    boundary.diffusion.module.getLoadedModelPath.mockResolvedValue(null);
    boundary.diffusion.module.loadModel.mockRejectedValue(
      new Error('weights corrupted'),
    );

    const result = await service.generateImage({ prompt: 'broken model' });

    expect(result).toBeNull();
    const s = service.getState();
    expect(s.phase).toBe('error');
    expect(s.error).toContain('Failed to load image model');
    expect(isInFlight(s.phase)).toBe(false);
  });
});
