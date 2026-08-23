import {
  CORE_SYNC_ENTITIES,
  mobileModelSettingPatch,
  modelSettingMutations,
} from '../../../src/services/sync/mutation';

describe('model settings sync contract', () => {
  it('round-trips every setting shared by desktop and mobile through canonical wire keys', () => {
    const localSettings = {
      temperature: 0.65,
      contextLength: 16_384,
      topP: 0.92,
      repeatPenalty: 1.15,
      maxTokens: 2_048,
      maxToolCalls: 25,
      systemPrompt: 'Answer from local context.',
      cacheType: 'q4_0',
      flashAttn: true,
      gpuLayers: 99,
      nThreads: 8,
      nBatch: 512,
    };
    const expectedWireToLocal = {
      temperature: 'temperature',
      ctxSize: 'contextLength',
      topP: 'topP',
      repeatPenalty: 'repeatPenalty',
      maxTokens: 'maxTokens',
      maxToolCalls: 'maxToolCalls',
      systemPrompt: 'systemPrompt',
      kvCacheType: 'cacheType',
      flashAttn: 'flashAttn',
      gpuLayers: 'gpuLayers',
      threads: 'nThreads',
      batchSize: 'nBatch',
    } as const;

    const mutations = modelSettingMutations({}, localSettings);

    expect(mutations).toHaveLength(Object.keys(expectedWireToLocal).length);
    for (const mutation of mutations) {
      const localKey =
        expectedWireToLocal[
          mutation.entityId as keyof typeof expectedWireToLocal
        ];
      expect(mutation).toMatchObject({
        entity: CORE_SYNC_ENTITIES.modelSetting,
        kind: 'put',
      });
      expect(
        mobileModelSettingPatch(mutation.entityId, mutation.fields ?? {}),
      ).toEqual({ [localKey]: localSettings[localKey] });
    }
  });

  it('ignores unsupported keys and malformed or unsafe peer values', () => {
    expect(
      mobileModelSettingPatch('performanceMode', {
        value_json: '"extreme"',
      }),
    ).toBeNull();
    expect(
      mobileModelSettingPatch('temperature', { value_json: 'not-json' }),
    ).toBeNull();
    expect(
      mobileModelSettingPatch('temperature', { value_json: '3' }),
    ).toBeNull();
    expect(
      mobileModelSettingPatch('ctxSize', { value_json: '1024.5' }),
    ).toBeNull();
    expect(
      mobileModelSettingPatch('kvCacheType', { value_json: '"unsafe"' }),
    ).toBeNull();
  });
});
