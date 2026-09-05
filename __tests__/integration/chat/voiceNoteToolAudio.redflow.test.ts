/**
 * A recorded voice note is transcribed before Shared chat generation. The LiteRT
 * native boundary receives the transcript as text and never receives the stale
 * recording path as model audio.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('voice note on LiteRT', () => {
  it('sends transcript text and no audio file to the native model', async () => {
    const h = await setupChatScreen({
      engine: 'litert',
      platform: 'android',
      whisper: true,
      pro: true,
    });
    await h.setupWhisperModel();
    h.render();
    await h.enterVoiceMode();

    try {
      const transcript = 'use the calculator for two plus two';
      const textCallCount = h.boundary.litert.calls.sendMessage.length;
      const audioCallCount =
        h.boundary.litert.module.sendMessageWithAudio.mock.calls.length +
        h.boundary.litert.calls.sendMessageWithMedia.length;

      await h.voiceSend(transcript, { content: 'The result is 4.' });

      await h.rtl.waitFor(() => {
        expect(h.boundary.litert.calls.sendMessage).toHaveLength(
          textCallCount + 1,
        );
        expect(
          h.useChatStore.getState().getActiveConversation?.()?.messages.at(-1)
            ?.content,
        ).toBe('The result is 4.');
      });

      expect(String(h.boundary.litert.calls.sendMessage.at(-1)?.[0])).toContain(
        transcript,
      );
      expect(
        h.boundary.litert.module.sendMessageWithAudio.mock.calls.length +
          h.boundary.litert.calls.sendMessageWithMedia.length,
      ).toBe(audioCallCount);
    } finally {
      h.view?.unmount();
      const pro = require('@offgrid/pro') as typeof import('../../../pro');
      await pro.deactivate();
    }
  });
});
