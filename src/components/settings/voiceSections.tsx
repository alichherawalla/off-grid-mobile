import React from 'react';
import { useAppStore } from '../../stores';
import {
  VOICE_TURN_LABELS,
  VOICE_DELAY_LABELS,
  SILENCE_AFTER_SPEECH_CHOICES_MS,
  SPEAKER_DRAIN_CHOICES_MS,
  DEFAULT_SILENCE_AFTER_SPEECH_MS,
  DEFAULT_SPEAKER_DRAIN_MS,
  secondsLabel,
  type VoiceTurnMode,
} from '@offgrid/speech';
import { SegmentedRow, type PillOption } from './segmentedRow';

/**
 * Voice-input settings.
 *
 * Separate from textGenAdvancedSections because this is about LISTENING, not text generation - the
 * two surfaces that show it (in-chat settings and Model Settings) both sit under Transcription.
 */

/**
 * How a spoken turn begins and ends.
 *
 * Three states, not a toggle, and labelled by what HAPPENS rather than by the technique: "VAD" means
 * nothing to the person choosing it.
 *
 * Voice mode only. Chat dictation is someone typing with their voice - they pause to think
 * mid-sentence and expect the recorder to wait - so it always behaves as 'tap'.
 */
// Names, descriptions, choices and defaults come from @offgrid/speech, which owns them: desktop
// renders the same rows, and two settings screens describing one setting differently is the drift
// this prevents.
const VOICE_TURN_ORDER: VoiceTurnMode[] = ['tap', 'silence', 'handsfree'];
const VOICE_TURN_OPTIONS = VOICE_TURN_ORDER.map(id => ({
  id,
  label: VOICE_TURN_LABELS[id].label,
}));

/** Millisecond choices rendered as pills: the id is the ms value, the label is "1s". */
const delayOptions = (choicesMs: readonly number[]): PillOption<string>[] =>
  choicesMs.map(ms => ({ id: String(ms), label: secondsLabel(ms) }));

const SILENCE_OPTIONS = delayOptions(SILENCE_AFTER_SPEECH_CHOICES_MS);
const DRAIN_OPTIONS = delayOptions(SPEAKER_DRAIN_CHOICES_MS);

export const VoiceTurnSettings: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const current = settings.voiceTurnMode ?? 'silence';
  const silenceMs = settings.voiceSilenceAfterSpeechMs ?? DEFAULT_SILENCE_AFTER_SPEECH_MS;
  const drainMs = settings.voiceSpeakerDrainMs ?? DEFAULT_SPEAKER_DRAIN_MS;
  return (
    <>
      <SegmentedRow<VoiceTurnMode>
        label="Voice turns"
        description={VOICE_TURN_LABELS[current].description}
        options={VOICE_TURN_OPTIONS}
        current={current}
        onSelect={(id) => updateSettings({ voiceTurnMode: id })}
        testIdFor={(id) => `voice-turn-${id}-button`}
      />
      {/* Each delay row appears only when it does something: the end-of-turn window never fires in
          tap mode, and the mic only reopens by itself in hands-free. */}
      {current !== 'tap' && (
        <SegmentedRow<string>
          label={VOICE_DELAY_LABELS.silenceAfterSpeech.label}
          description={VOICE_DELAY_LABELS.silenceAfterSpeech.description}
          options={SILENCE_OPTIONS}
          current={String(silenceMs)}
          onSelect={(id) => updateSettings({ voiceSilenceAfterSpeechMs: Number(id) })}
          testIdFor={(id) => `voice-silence-${id}-button`}
        />
      )}
      {current === 'handsfree' && (
        <SegmentedRow<string>
          label={VOICE_DELAY_LABELS.speakerDrain.label}
          description={VOICE_DELAY_LABELS.speakerDrain.description}
          options={DRAIN_OPTIONS}
          current={String(drainMs)}
          onSelect={(id) => updateSettings({ voiceSpeakerDrainMs: Number(id) })}
          testIdFor={(id) => `voice-drain-${id}-button`}
        />
      )}
    </>
  );
};
