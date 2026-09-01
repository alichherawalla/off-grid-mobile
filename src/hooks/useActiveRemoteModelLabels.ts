import { useEffect, useState } from 'react';
import {
  activeMobileModel,
  mobileLLMService,
  refreshMobileModelServices,
} from '../services/modelServices';

type RemoteLabels = {
  image: string | null;
  transcription: string | null;
  voice: string | null;
};

function labels(): RemoteLabels {
  const name = (modality: keyof RemoteLabels): string | null => {
    const model = activeMobileModel(modality).model;
    return model?.source === 'remote' ? model.name : null;
  };
  return {
    image: name('image'),
    transcription: name('transcription'),
    voice: name('voice'),
  };
}

/** Human labels for the active server's selected media models. */
export function useActiveRemoteModelLabels(): RemoteLabels {
  const [snapshot, setSnapshot] = useState(labels);
  useEffect(() => {
    const publish = () => setSnapshot(labels());
    const unsubscribe = mobileLLMService.subscribe(publish);
    refreshMobileModelServices().then(publish).catch(() => undefined);
    return unsubscribe;
  }, []);
  return snapshot;
}
