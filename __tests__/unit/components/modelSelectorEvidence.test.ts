import type { RemoteServer } from '../../../src/types';
import '../../harness/activeModelLifecycle';
import {
  savedImageModels,
  savedTextModels,
} from '../../../src/components/ModelSelectorModal';

const server: RemoteServer = {
  id: 'server-1',
  name: 'Studio',
  endpoint: 'http://studio.test/v1',
  provider: 'openai-compatible',
  createdAt: '2026-09-01T00:00:00.000Z',
  selections: { text: 'chat-model', image: 'image-model' },
};

describe('model selector evidence and loading policy', () => {
  it('does not fabricate negative capabilities for undiscovered saved routes', () => {
    expect(savedTextModels(server)[0]?.capabilities).toEqual({});
    expect(savedImageModels(server)[0]?.capabilities).toEqual({});
  });

  it('keeps catalog capability evidence without filling unknown fields', () => {
    const catalogServer: RemoteServer = {
      ...server,
      catalog: {
        text: [{
          id: 'chat-model',
          name: 'Chat Model',
          capabilities: { supportsVision: true },
        }],
      },
    };

    expect(savedTextModels(catalogServer)[0]?.capabilities).toEqual({
      supportsVision: true,
    });
  });

});
