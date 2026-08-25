import { useCallback } from 'react';
import { showAlert, hideAlert } from '../../../components';
import { remoteServerManager } from '../../../services';
import { discoverLANServers } from '../../../services/networkDiscovery';
import { useAppStore } from '../../../stores/appStore';
import { shouldAutoDiscoverRemoteModels } from '../../../utils/remoteAutoDiscovery';
import type { HomeScreenNavigationProp } from './types';
import logger from '../../../utils/logger';

interface LANDiscoveryParams {
  navigation: HomeScreenNavigationProp;
  setAlertState: (state: any) => void;
}

export function useLANDiscovery({ navigation, setAlertState }: LANDiscoveryParams) {
  const addNewServersAndNotify = useCallback(async (
    newServersToAdd: Awaited<ReturnType<typeof discoverLANServers>>
  ) => {
    for (const server of newServersToAdd) {
      logger.log('[HomeScreen] Auto-adding discovered server:', server.name);
      const added = await remoteServerManager.addServer({
        name: server.name,
        endpoint: server.endpoint,
        providerType: 'openai-compatible',
      });
      remoteServerManager.testConnection(added.id).catch(() => { });
    }

    if (newServersToAdd.length === 0) return;

    const names = newServersToAdd.map(s => s.name).join(', ');
    const title = newServersToAdd.length === 1
      ? 'LLM Server Found'
      : `${newServersToAdd.length} LLM Servers Found`;
    setAlertState(showAlert(
      title,
      `Discovered on your network: ${names}. You can select a model from the model picker.`,
      [
        { text: 'Dismiss', style: 'cancel' },
        {
          text: 'View Servers', onPress: () => {
            setAlertState(hideAlert());
            navigation.navigate('RemoteServers');
          }
        },
      ],
    ));
  }, [navigation, setAlertState]);

  const runLANDiscovery = useCallback(async () => {
    // The automatic LAN scan runs only when the user has enabled auto-discovery. Fresh installs are
    // OFF — never scan the network unprompted. (The "Scan Network" button is a separate, explicit
    // action and is NOT gated here.)
    if (!shouldAutoDiscoverRemoteModels(useAppStore.getState().settings)) {
      logger.log('[HomeScreen] LAN auto-discovery disabled in settings — skipping');
      return;
    }
    logger.log('[HomeScreen] LAN auto-discovery enabled — scanning');
    // remoteServerManager owns the scan + moved-server reconciliation (one source of truth); the
    // hook only surfaces the genuinely-new servers it finds.
    const { found } = await remoteServerManager.scanAndReconcile();
    await addNewServersAndNotify(found);
  }, [addNewServersAndNotify]);

  return { runLANDiscovery };
}
