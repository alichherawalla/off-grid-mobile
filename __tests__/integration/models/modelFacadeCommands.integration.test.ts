import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { readMobileModelSelection } from '../../../src/services/modelServices/modelSelectionProjection';
import {
  selectModelRoute,
  unloadAndClearModel,
} from '../../../src/services/modelServices/modelFacadeCommands';
import { decodeModelRouteId } from '@offgrid/models';
import { createDownloadedModel } from '../../utils/factories';
import { resetStores } from '../../utils/testHelpers';
import { resetModelApplication } from '../../harness/activeModelLifecycle';

describe('Mobile model commands through the public application facade', () => {
  beforeEach(async () => {
    resetStores();
    useRemoteServerStore.setState({ servers: [], serverHealth: {} });
    await resetModelApplication();
  });

  it('selects a newly installed local route after the explicit inventory refresh', async () => {
    const model = createDownloadedModel({ id: 'local-text', engine: 'llama' });
    useAppStore.setState({ downloadedModels: [model] });

    await selectModelRoute({
      source: 'local',
      hostId: model.engine,
      modality: 'text',
      modelId: model.id,
    });

    expect(decodeModelRouteId(readMobileModelSelection('text') ?? '')).toMatchObject({
      providerId: 'llama',
      modelId: 'local-text',
    });
  });

  it('unloads and clears the canonical route without a second command owner', async () => {
    const model = createDownloadedModel({ id: 'local-text', engine: 'llama' });
    useAppStore.setState({ downloadedModels: [model] });
    await selectModelRoute({
      source: 'local',
      hostId: model.engine,
      modality: 'text',
      modelId: model.id,
    });

    await unloadAndClearModel('text');

    expect(readMobileModelSelection('text')).toBeNull();
  });
});
