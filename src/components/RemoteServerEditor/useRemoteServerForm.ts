import { useState, useCallback, useEffect } from 'react';
import { remoteServerManager } from '../../services/remoteServerManager';
import { useRemoteServerStore } from '../../stores';
import { RemoteServer, RemoteModel } from '../../types';
import { isPrivateNetworkEndpoint } from '../../services/httpClient';
import { AlertState, initialAlertState, showAlert } from '../CustomAlert';

interface FormOptions {
  server?: RemoteServer;
  visible: boolean;
  onSave?: (server: RemoteServer) => void;
  onClose: () => void;
}

export function useRemoteServerForm({ server, visible, onSave, onClose }: FormOptions) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [notes, setNotes] = useState('');
  const [imageModelId, setImageModelId] = useState('');
  const [transcriptionModelId, setTranscriptionModelId] = useState('');
  const [voiceModelId, setVoiceModelId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<RemoteModel[]>([]);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  // Initialize form when editing existing server
  useEffect(() => {
    let cancelled = false;
    if (server) {
      setName(server.name);
      setEndpoint(server.endpoint);
      setNotes(server.notes || '');
      setImageModelId(server.mediaModels?.image || '');
      setTranscriptionModelId(server.mediaModels?.transcription || '');
      setVoiceModelId(server.mediaModels?.voice || '');
      // Load existing API key from keychain so user can see it's set
      remoteServerManager.getApiKey(server.id).then((key) => {
        if (!cancelled) setApiKey(key || '');
      }).catch(() => { if (!cancelled) setApiKey(''); });
    } else {
      // Reset form for new server
      setName('');
      setEndpoint('');
      setApiKey('');
      setNotes('');
      setImageModelId('');
      setTranscriptionModelId('');
      setVoiceModelId('');
    }
    setErrors({});
    setTestResult(null);
    setDiscoveredModels([]);
    return () => { cancelled = true; };
  }, [server, visible]);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = 'Server name is required';
    }
    if (endpoint.trim()) {
      try {
        // Validate URL format by parsing it - constructor throws on invalid URLs
        new URL(endpoint); // eslint-disable-line no-new
      } catch {
        newErrors.endpoint = 'Invalid URL format';
      }
    } else {
      newErrors.endpoint = 'Endpoint URL is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, endpoint]);

  const handleTestConnection = useCallback(async () => {
    if (!validateForm()) return;
    setIsTesting(true);
    setTestResult(null);
    setDiscoveredModels([]);
    try {
      const result = await remoteServerManager.testConnectionByEndpoint(endpoint, apiKey || undefined);
      if (result.success) {
        const resolvedUrl = `${endpoint.replace(/\/+$/, '')}/v1/models`;
        setTestResult({ success: true, message: `Connected (${result.latency}ms)\n${resolvedUrl}` });
        if (result.models && result.models.length > 0) {
          setDiscoveredModels(result.models);
        }
        if (result.mediaModels) {
          setImageModelId((current) => current || result.mediaModels?.image || '');
          setTranscriptionModelId(
            (current) => current || result.mediaModels?.transcription || '',
          );
          setVoiceModelId((current) => current || result.mediaModels?.voice || '');
        }
      } else {
        const triedUrl = `${endpoint.replace(/\/+$/, '')}/v1/models`;
        setTestResult({ success: false, message: `${result.error || 'Connection failed'}\nTried: ${triedUrl}` });
      }
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsTesting(false);
    }
  }, [endpoint, apiKey, validateForm]);

  const saveServer = useCallback(async () => {
    try {
      const mediaModels = {
        ...(imageModelId.trim() ? { image: imageModelId.trim() } : {}),
        ...(transcriptionModelId.trim()
          ? { transcription: transcriptionModelId.trim() }
          : {}),
        ...(voiceModelId.trim() ? { voice: voiceModelId.trim() } : {}),
      };
      if (server) {
        await remoteServerManager.updateServer(server.id, {
          name,
          endpoint,
          notes,
          apiKey,
          mediaModels,
        });
        if (discoveredModels.length > 0) {
          useRemoteServerStore.getState().setDiscoveredModels(server.id, discoveredModels);
        }
        onSave?.(server);
      } else {
        const newServer = await remoteServerManager.addServer({
          name,
          endpoint,
          providerType: 'openai-compatible',
          notes: notes || undefined,
          apiKey: apiKey || undefined,
          mediaModels,
        });
        if (discoveredModels.length > 0) {
          useRemoteServerStore.getState().setDiscoveredModels(newServer.id, discoveredModels);
        }
        // Probe before closing so no network work outlives this editor session.
        await remoteServerManager.testConnection(newServer.id).catch(() => undefined);
        onSave?.(newServer);
      }
      onClose();
    } catch (error) {
      setAlertState(showAlert('Error', error instanceof Error ? error.message : 'Failed to save server'));
    }
  }, [
    server,
    name,
    endpoint,
    apiKey,
    notes,
    imageModelId,
    transcriptionModelId,
    voiceModelId,
    discoveredModels,
    onSave,
    onClose,
  ]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;
    // Warn if connecting to public internet
    if (endpoint && !isPrivateNetworkEndpoint(endpoint)) {
      setAlertState(showAlert(
        'Public Network Warning',
        'This endpoint appears to be on the public internet. Your data will be sent to a remote server. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => saveServer() },
        ]
      ));
    } else {
      saveServer();
    }

  }, [validateForm, endpoint, saveServer]);

  return {
    name, setName,
    endpoint, setEndpoint,
    apiKey, setApiKey,
    notes, setNotes,
    imageModelId, setImageModelId,
    transcriptionModelId, setTranscriptionModelId,
    voiceModelId, setVoiceModelId,
    errors,
    isTesting,
    testResult,
    discoveredModels,
    handleTestConnection,
    handleSave,
    isPublicNetwork: !!(endpoint && !isPrivateNetworkEndpoint(endpoint)),
    alertState,
    dismissAlert: () => setAlertState(initialAlertState),
  };
}
