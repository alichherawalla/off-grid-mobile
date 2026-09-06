/**
 * HAPPY PATH — an audio-mode recording is transcribed and sent as the turn text.
 *
 * The Mobile composition, Shared model inventory/selection, voice-input hook, recorder service,
 * transcription route, and LiteRT service are real. The filesystem, LiteRT runtime, Whisper runtime,
 * and microphone recorder remain at the native boundary.
 */
import { setupChatScreen } from '../../harness/chatHarness';

describe('happy — audio-mode transcription auto-sends the spoken text', () => {
  it('records, transcribes, and dispatches the transcript as the turn content', async () => {
    const h = await setupChatScreen({
      engine: 'litert',
      platform: 'ios',
      whisper: true,
      audio: true,
    });
    await h.setupWhisperModel('tiny.en');
    h.boundary.whisper!.setFileTranscript('book a flight to tokyo');

    const {
      useVoiceInput,
    } = require('../../../src/components/ChatInput/Voice');
    const onAutoSend = jest.fn();
    const { result } = h.rtl.renderHook(() =>
      useVoiceInput({
        conversationId: 'c1',
        onTranscript: () => {},
        interfaceMode: 'audio',
        onAutoSend,
        onAudioAttachment: () => {},
      }),
    );

    await h.rtl.act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);
    await h.rtl.act(async () => {
      await result.current.stopRecording();
    });

    expect(onAutoSend).toHaveBeenCalledWith(
      'book a flight to tokyo',
      expect.objectContaining({ format: 'wav' }),
    );
  });
});
