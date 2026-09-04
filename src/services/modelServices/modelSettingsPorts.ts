import type { ModelsSettingsPort } from '@offgrid/application';
import { APP_CONFIG } from '../../constants';
import { useAppStore } from '../../stores/appStore';
import type { AppSettings } from '../../types';
import { emitCommittedModelSettings } from '../sync/mutation';

/**
 * I/O for the shared settings command. It never decides anything: shared normalizes, validates,
 * diffs and plans the mutations, and only the committed result reaches here.
 *
 * `restartEngine` is deliberately absent. Mobile has never restarted the text engine when a launch
 * setting changed - the next load picks the new arguments up - so supplying one here would be a new
 * behaviour, not an adoption. Shared reports `launch: null` for this device, exactly as today.
 */
export const mobileModelSettingsPorts: ModelsSettingsPort = {
  platform: 'mobile',
  defaults: { systemPrompt: APP_CONFIG.defaultSystemPrompt },
  read: () => useAppStore.getState().settings,
  // ONE store write of the whole committed record. Not a per-key `updateSettings`, whose own
  // portable-setting scan would publish a second time on top of the command's plan.
  write: async settings => {
    useAppStore.getState().replaceCommittedSettings(settings as AppSettings);
  },
  publish: async mutations => {
    emitCommittedModelSettings(mutations);
  },
};
