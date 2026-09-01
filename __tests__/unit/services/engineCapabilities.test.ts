import type { RuntimeModel } from '@offgrid/models';
import { engineCapabilitiesFromRuntime } from '../../../src/services/engines';

function runtime(capabilities: RuntimeModel['capabilities']): RuntimeModel {
  return {
    id: 'model',
    name: 'Model',
    kind: 'text',
    source: 'remote',
    modality: 'text',
    adapterId: 'adapter',
    serverId: 'server',
    capabilities,
    installed: true,
    ready: true,
    loaded: false,
    loading: false,
  };
}

describe('engine capability presentation', () => {
  it('fails closed when there is no canonical runtime model', () => {
    expect(engineCapabilitiesFromRuntime(null)).toEqual({
      vision: false, audio: false, tools: false, thinking: false,
    });
  });

  it('projects only the capabilities owned by the canonical runtime model', () => {
    expect(engineCapabilitiesFromRuntime(runtime({
      vision: true,
      audioInput: true,
      tools: true,
      thinking: true,
    }))).toEqual({ vision: true, audio: true, tools: true, thinking: true });
  });

  it('does not infer missing capabilities from provider or model names', () => {
    expect(engineCapabilitiesFromRuntime(runtime({ textGeneration: true }))).toEqual({
      vision: false, audio: false, tools: false, thinking: false,
    });
  });
});
