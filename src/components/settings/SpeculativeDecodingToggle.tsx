import React from 'react';
import { useAppStore } from '../../stores';
import { SegmentedRow, BOOL_OPTIONS } from './segmentedRow';

/**
 * MTP speculative decoding. The model drafts several tokens per step and verifies them in a single
 * pass, so a turn finishes in fewer forward passes — the win is wall-clock, not quality: verified
 * tokens are exactly the tokens the model would have produced anyway.
 *
 * Only models shipped with MTP draft layers can do it. The engine silently never drafts on the
 * rest, so this is a preference rather than a promise, and the copy says so instead of claiming a
 * speed-up every model will deliver.
 */
export const SpeculativeDecodingToggle: React.FC = () => {
  const speculativeDecoding = useAppStore(s => s.settings.speculativeDecoding);
  const updateSettings = useAppStore(s => s.updateSettings);
  return (
    <SegmentedRow<'off' | 'on'>
      label="Speculative Decoding (MTP)"
      description="Drafts several tokens per step and checks them together. Faster on models built with MTP layers; no effect on others. Requires model reload."
      options={BOOL_OPTIONS}
      current={speculativeDecoding ? 'on' : 'off'}
      onSelect={(id) => updateSettings({ speculativeDecoding: id === 'on' })}
      testIdFor={(id) => `speculative-${id}-button`}
    />
  );
};
