import { useActiveMobileModel } from '../hooks/useActiveMobileModel';
/**
 * Remote Servers
 *
 * Point this phone at a machine that can run models it cannot: Off Grid AI Desktop on a Mac,
 * or an Ollama / LM Studio server on the same network.
 */

import { callHook, HOOKS } from '../bootstrap/hookRegistry';
import {
  REMOTE_LAN_PROVIDER_KINDS,
  REMOTE_LAN_PROVIDER_LABELS,
  remoteLanScanKinds,
  type RemoteLanProviderKind,
} from '@offgrid/models';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, useThemedStyles } from '../theme';
import { useRemoteServerStore, useAppStore } from '../stores';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { ThinkingIndicator } from '../components/ThinkingIndicator';
import { RootStackParamList } from '../navigation/types';
import { remoteServerManager } from '../services/remoteServerManager';
import {
  clearMobileModel,
  selectRemoteMobileModel,
} from '../services/modelServices';
import {
  CustomAlert,
  AlertState,
  initialAlertState,
  showAlert,
} from '../components/CustomAlert';
import { OFF_GRID_DESKTOP_URL } from '../constants';
import { withUtm } from '../utils/utm';
import { createStyles } from './RemoteServersScreen.styles';

const DESKTOP_URL = withUtm(OFF_GRID_DESKTOP_URL, 'remote-servers');

type NavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'RemoteServers'
>;

/** Say what was actually tried: the ports are what has to be listening on the other machine. */
function scanEmptyNote(savedCount: number): string {
  return savedCount > 0
    ? 'Everything on this network is already in your list.'
    : 'Nothing answered on this network. Off Grid AI Desktop serves on port 7878, Ollama on 11434, LM Studio on 1234.';
}

/** Which server kinds a scan looks for. Shared owns the default and the filter; this only renders. */
const ScanKindToggles: React.FC<{ styles: any; theme: any }> = ({ styles, theme }) => {
  // Select the stored value, never a fresh array: a selector that returns a new array every render
  // re-renders for ever under useSyncExternalStore and takes the app down.
  const storedKinds = useAppStore(s => s.settings.remoteScanKinds);
  const scanKinds = useMemo(() => remoteLanScanKinds({ remoteScanKinds: storedKinds }), [storedKinds]);
  const updateSettings = useAppStore(s => s.updateSettings);
  const toggle = (kind: RemoteLanProviderKind, on: boolean) => {
    const next = REMOTE_LAN_PROVIDER_KINDS.filter(candidate =>
      candidate === kind ? on : scanKinds.includes(candidate),
    );
    // Shared treats an empty choice as "everything"; keep one kind on so the switch you just
    // turned off stays off.
    updateSettings({ remoteScanKinds: next.length ? next : [kind] });
  };
  return (
    <View style={styles.kindGroup}>
      {REMOTE_LAN_PROVIDER_KINDS.map(kind => (
        <View key={kind} style={styles.kindRow}>
          <View style={styles.cardTextCol}>
            <Text style={styles.cardDesc}>{REMOTE_LAN_PROVIDER_LABELS[kind]}</Text>
          </View>
          <Switch
            testID={`scan-kind-${kind}`}
            value={scanKinds.includes(kind)}
            onValueChange={on => toggle(kind, on)}
            trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
          />
        </View>
      ))}
    </View>
  );
};

/** The scan action: each server joins the list as it answers; the note reads found-so-far and percent. */
function useScanNetwork({
  servers,
  scanKindLabels,
  setIsScanning,
  setScanNote,
}: {
  servers: readonly unknown[];
  scanKindLabels: readonly string[];
  setIsScanning: (value: boolean) => void;
  setScanNote: (value: string | null) => void;
}) {
  return useCallback(async () => {
    setIsScanning(true);
    setScanNote(null);
    try {
      // Paired devices first: a Mac you paired over sync is a server without any scan.
      await callHook<Promise<void>>(HOOKS.remoteServersAdoptPaired)?.catch(() => undefined);
      // Each server joins the list the moment it answers; the scan keeps going behind it.
      let addedSoFar = 0;
      let percent = 0;
      const note = () => {
        const found = addedSoFar ? `Found ${addedSoFar} so far. ` : '';
        setScanNote(`${found}Looking for ${scanKindLabels.join(', ')}… ${percent}%`);
      };
      note();
      const { found: newServers } = await remoteServerManager.scanAndReconcile(
        async found => {
          const server = await remoteServerManager.addServer({
            name: found.name,
            endpoint: found.endpoint,
            provider: 'openai-compatible',
          });
          remoteServerManager.testConnection(server.id).catch(() => {});
          addedSoFar += 1;
          note();
        },
        (done, total) => {
          const next = total ? Math.floor((done / total) * 100) : 0;
          if (next !== percent) {
            percent = next;
            note();
          }
        },
      );
      if (newServers.length === 0) {
        // Say what was actually tried. "No servers found" leaves the user with nothing to act
        // on; the ports do, because that is what has to be listening on the other machine.
        setScanNote(scanEmptyNote(servers.length));
        return;
      }
      setScanNote(
        `Added ${newServers.length} server${newServers.length > 1 ? 's' : ''}.`,
      );
    } catch (error) {
      setScanNote(
        error instanceof Error ? error.message : 'The scan could not finish.',
      );
    } finally {
      setIsScanning(false);
    }
  }, [servers, scanKindLabels, setIsScanning, setScanNote]);
}

export const RemoteServersScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { servers, serverHealth } = useRemoteServerStore();
  const activeServerId = useActiveMobileModel('text').model?.serverId ?? null;
  const autoDiscover = useAppStore(
    s => s.settings.autoDiscoverRemoteModels === true,
  );
  const updateSettings = useAppStore(s => s.updateSettings);
  const storedScanKinds = useAppStore(s => s.settings.remoteScanKinds);
  const scanKindLabels = useMemo(
    () => remoteLanScanKinds({ remoteScanKinds: storedScanKinds }).map(kind => REMOTE_LAN_PROVIDER_LABELS[kind]),
    [storedScanKinds],
  );

  const [testingId, setTestingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  // Auto-check all server statuses when screen opens
  useEffect(() => {
    servers.forEach(server => {
      remoteServerManager.testConnection(server.id).catch(() => { });
    });

  // Status refresh belongs to this screen-open event, not every health projection update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTestServer = useCallback(async (serverId: string) => {
    setTestingId(serverId);
    try {
      const result = await remoteServerManager.testConnection(serverId);
      // The row's own status line already says Connected or Offline, so a success needs no
      // dialog to dismiss. Only a failure earns one, because it carries the reason.
      if (!result.success) {
        setAlertState(showAlert('Could not connect', result.error || 'The server did not answer.'));
      }
    } catch (error) {
      setAlertState(showAlert('Could not connect', error instanceof Error ? error.message : 'The server did not answer.'));
    } finally {
      setTestingId(null);
    }
  }, []);

  const handleScanNetwork = useScanNetwork({ servers, scanKindLabels, setIsScanning, setScanNote });

  const handleDeleteServer = useCallback(
    (server: (typeof servers)[0]) => {
      setAlertState(
        showAlert(
      'Remove this server',
      `"${server.name}" will be removed from this phone. The server itself is not touched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await remoteServerManager.removeServer(server.id);
          },
        },
          ],
        ),
      );
    },
    [],
  );

  const handleUseServer = useCallback(
    async (server: (typeof servers)[0]) => {
      if (activeServerId === server.id) {
        await clearMobileModel('text');
        return;
      }
      const textModelId = server.selections?.text;
      if (textModelId) {
        try {
          await selectRemoteMobileModel(server.id, 'text', textModelId);
          return;
        } catch (error) {
          setAlertState(showAlert('Could not use this model', error instanceof Error
            ? error.message : 'The server did not load the selected model.'));
          return;
        }
      }
      setAlertState(showAlert(
        'Select a text model first',
        'Open this server and select the text model that you want to use.',
      ));
    },
    [activeServerId],
  );

  const openDesktopUrl = useCallback(() => {
    Linking.openURL(DESKTOP_URL).catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Remote Servers" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.intro}>
          Run models this phone cannot hold. Another machine on your network
          does the work and the answer comes back here, over your own Wi-Fi.
        </Text>

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardTextCol}>
              <Text style={styles.cardTitle}>Auto-discover on Wi-Fi</Text>
            </View>
            <Switch
              testID="auto-discover-toggle"
              value={autoDiscover}
              onValueChange={v =>
                updateSettings({ autoDiscoverRemoteModels: v })
              }
              trackColor={{
                false: theme.colors.border,
                true: theme.colors.primary,
              }}
            />
          </View>
          <ScanKindToggles styles={styles} theme={theme} />
        </View>

        <View style={styles.actionRow}>
          {/* No `loading` prop: it swaps the label for the platform spinner, and on Android that
              glyph reads as a retry arrow - the same thing that made the chat loading bar look
              like a failure. The dots below carry the waiting instead. */}
          <Button
            title={isScanning ? 'Scanning' : 'Scan network'}
            onPress={handleScanNetwork}
            disabled={isScanning}
            style={styles.actionButton}
            testID="scan-network"
            icon={<Icon name="wifi" size={14} color={theme.colors.primary} />}
          />
          <Button
            title="Add manually"
            variant="secondary"
            onPress={() => navigation.navigate('RemoteServerEditor')}
            style={styles.actionButton}
            testID="add-server"
            icon={<Icon name="plus" size={14} color={theme.colors.text} />}
          />
        </View>
        {isScanning ? (
          <ThinkingIndicator
            text="Looking for servers on your Wi-Fi"
            textStyle={styles.scanNote}
          />
        ) : null}
        {!isScanning && scanNote ? (
          <Text style={styles.scanNote}>{scanNote}</Text>
        ) : null}

        {servers.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No servers yet</Text>
            <Text style={styles.emptyText}>
              Off Grid AI Desktop serves your Mac&apos;s models to this phone.
              Ollama and LM Studio work the same way.
            </Text>
            <TouchableOpacity
              style={styles.desktopLink}
              onPress={openDesktopUrl}
              accessibilityRole="link"
              accessibilityLabel="Get Off Grid AI Desktop"
            >
              <Icon name="monitor" size={14} color={theme.colors.primary} />
              <Text style={styles.desktopLinkText}>
                Get Off Grid AI Desktop
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>Servers</Text>
            {servers.map(server => {
              const isTesting = testingId === server.id;
              const isActive = activeServerId === server.id;
              const health = serverHealth[server.id];

              let statusColor = styles.statusDotUnknown;
              if (health?.status === 'healthy')
                statusColor = styles.statusDotActive;
              else if (health?.status === 'unhealthy')
                statusColor = styles.statusDotInactive;

              let statusText = 'Not checked yet';
              if (isTesting) statusText = 'Checking';
              else if (health?.status === 'healthy') statusText = 'Connected';
              else if (health?.status === 'unhealthy')
                statusText = 'Not answering';

              return (
                <View
                  key={server.id}
                  style={[
                    styles.serverCard,
                    isActive && styles.serverCardActive,
                  ]}
                  testID={`server-${server.id}`}
                >
                  {/* Tapping the server chooses it. The store has always had an active server
                      and this screen never let you set one, so the only way to pick was to go
                      somewhere else. */}
                  <TouchableOpacity
                    style={styles.serverIdentity}
                    onPress={() => handleUseServer(server)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isActive
                        ? `Stop using ${server.name}`
                        : `Use ${server.name}`
                    }
                    testID={`server-use-${server.id}`}
                  >
                    <View style={styles.serverTopRow}>
                      <View style={[styles.statusDot, statusColor]} />
                      <Text style={styles.serverName} numberOfLines={1}>
                        {server.name}
                      </Text>
                      <Text
                        style={isActive ? styles.activeBadge : styles.useHint}
                      >
                        {isActive ? 'In use' : 'Use'}
                      </Text>
                    </View>
                    <Text style={styles.serverEndpoint} numberOfLines={1}>
                      {server.endpoint}
                    </Text>
                    <Text style={styles.serverStatus}>{statusText}</Text>
                  </TouchableOpacity>

                  <View style={styles.serverActions}>
                    <TouchableOpacity
                      style={styles.serverAction}
                      onPress={() => handleTestServer(server.id)}
                      disabled={isTesting}
                    >
                      {/* The row's status line already says "Checking", so the icon stays put
                          rather than being swapped for a spinner that reads as retry. */}
                      <Icon
                        name="refresh-cw"
                        size={13}
                        color={theme.colors.textSecondary}
                      />
                      <Text style={styles.serverActionText}>
                        {isTesting ? 'Checking' : 'Test'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.serverAction}
                      onPress={() =>
                        navigation.navigate('RemoteServerEditor', {
                          serverId: server.id,
                        })
                      }
                    >
                      <Icon
                        name="edit-2"
                        size={13}
                        color={theme.colors.textSecondary}
                      />
                      <Text style={styles.serverActionText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.serverAction, styles.serverActionDanger]}
                      onPress={() => handleDeleteServer(server)}
                    >
                      <Icon
                        name="trash-2"
                        size={13}
                        color={theme.colors.error}
                      />
                      <Text
                        style={[
                          styles.serverActionText,
                          styles.serverActionDangerText,
                        ]}
                      >
                        Remove
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <CustomAlert
        {...alertState}
        onClose={() => setAlertState(initialAlertState)}
      />
    </SafeAreaView>
  );
};
