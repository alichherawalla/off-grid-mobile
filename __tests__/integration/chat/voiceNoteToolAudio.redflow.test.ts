/**
 * Native-boundary integration for the transcript-only voice-note rule. The shared
 * GenerationService and the real Mobile LiteRT adapter run above the native fake.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel, createMessage } from '../../utils/factories';
import { setupWithConversation } from '../../utils/testHelpers';

describe('voice note on LiteRT', () => {
  it('sends transcript text and no audio file to the native model', async () => {
    const boundary = installNativeBoundary({
      ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 },
    });
    const { useAppStore } = require('../../../src/stores/appStore');
    const {
      refreshMobileModelServices,
      selectMobileModel,
    } = require('../../../src/services/modelServices');
    const { generationService } = require('../../../src/services/generationService');

    useAppStore.setState({
      downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })],
      activeModelId: 'lrt',
    });
    await refreshMobileModelServices();
    await selectMobileModel({
      source: 'local',
      hostId: 'litert',
      modelId: 'lrt',
      modality: 'text',
    });
    boundary.litert!.scriptTurn({ content: 'The result is 4.' });

    const conversationId = setupWithConversation({ modelId: 'lrt' });
    await generationService.generateResponse(conversationId, [createMessage({
      role: 'user',
      content: 'use the calculator for two plus two',
      attachments: [{
        id: 'voice-note',
        type: 'audio',
        uri: '/stale/container/voice-note.wav',
        mimeType: 'audio/wav',
        audioFormat: 'wav',
      }],
    })]);

    expect(generationService.getState().isGenerating).toBe(false);
    const audioCalls = [
      ...boundary.litert!.module.sendMessageWithAudio.mock.calls,
      ...boundary.litert!.calls.sendMessageWithMedia,
    ];
    const audioSentToNative = audioCalls.flatMap(call => {
      const candidate = call[call.length - 1];
      return Array.isArray(candidate) ? candidate : [];
    });
    expect(audioSentToNative).toEqual([]);
  });
});
