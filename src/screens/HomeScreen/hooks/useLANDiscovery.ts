import { useCallback } from 'react';
import { showAlert, hideAlert, type AlertState } from '../../../components';
import { applicationFacade } from '../../../services/applicationFacade';
import {
  modelsFailureMessage,
  shouldAutoDiscoverRemoteModels,
  type DiscoveredRemoteServer,
} from '@offgrid/application';
import { useAppStore } from '../../../stores/appStore';
import type { HomeScreenNavigationProp } from './types';
import logger from '../../../utils/logger';

interface LANDiscoveryParams {
  navigation: HomeScreenNavigationProp;
  setAlertState: (state: AlertState) => void;
}

export function useLANDiscovery({ navigation, setAlertState }: LANDiscoveryParams) {
  const addNewServersAndNotify = useCallback(async (
    newServersToAdd: DiscoveredRemoteServer[]
  ) => {
    const connectionFailures: string[] = [];
    for (const server of newServersToAdd) {
      logger.log('[HomeScreen] Auto-adding discovered server:', server.name);
      const saved = await applicationFacade().models.saveRemoteServer({
        name: server.name,
        endpoint: server.endpoint,
        provider: 'openai-compatible',
      });
      if (!saved.ok) {
        const message = modelsFailureMessage(saved.failure);
        logger.error(`[HomeScreen] Failed to save ${server.name}: ${message}`);
        connectionFailures.push(`${server.name}: ${message}`);
        continue;
      }
      try {
        const result = await applicationFacade().models.checkRemoteServer(
          saved.value.id,
        );
        if (!result.success) {
          connectionFailures.push(
            `${server.name}: ${result.error ?? 'Connection check failed'}`,
          );
        }
      } catch (error: unknown) {
        logger.error(
          `[HomeScreen] Connection check failed for ${server.name}`,
          error,
        );
        connectionFailures.push(
          `${server.name}: ${
            error instanceof Error ? error.message : 'Connection check failed'
          }`,
        );
      }
    }

    if (newServersToAdd.length === 0) return;
    if (connectionFailures.length > 0) {
      setAlertState(showAlert(
        'Server Check Failed',
        connectionFailures.join('\n'),
      ));
      return;
    }

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
    const reconciled = await applicationFacade().models.reconcileRemoteServers();
    if (!reconciled.ok) {
      const message = modelsFailureMessage(reconciled.failure);
      logger.error(`[HomeScreen] LAN discovery failed: ${message}`);
      setAlertState(showAlert('Network Scan Failed', message));
      return;
    }
    await addNewServersAndNotify([...reconciled.value.found]);
  }, [addNewServersAndNotify, setAlertState]);

  return { runLANDiscovery };
}
