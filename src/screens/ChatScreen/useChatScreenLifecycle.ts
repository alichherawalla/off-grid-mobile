import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { NavigationProp } from '@react-navigation/native';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  contextCompactionService,
  imageGenerationService,
  ImageGenerationState,
} from '../../services';
import { generationSession } from '../../services/generationSession';
import { useChatStore } from '../../stores';
import type { RootStackParamList } from '../../navigation/types';
import { mobileChatSession } from './mobileChatSession';

/** A missing stream never belongs to a missing conversation. */
export function isStreamingActiveConversation(
  streamingConversationId: string | null,
  activeConversationId: string | null,
): boolean {
  return (
    streamingConversationId !== null &&
    streamingConversationId === activeConversationId
  );
}

export function useChatAudioLifecycle(
  navigation: Pick<NavigationProp<RootStackParamList>, 'addListener'>,
): void {
  useEffect(() => {
    // Leaving is unconditional. audioStop deliberately protects a warm-but-idle engine, which is
    // right at the start of a turn and wrong here: a reply that had not begun playing yet survived the
    // guard and started speaking into a screen the person had already left.
    const unsubscribeBlur = navigation.addListener('blur', () => {
      callHook(HOOKS.audioStopForExit);
    });
    const unsubscribeRemove = navigation.addListener('beforeRemove', () => {
      callHook(HOOKS.audioStopForExit);
    });
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        callHook(
          nextState === 'active'
            ? HOOKS.audioOnAppForeground
            : HOOKS.audioOnAppBackground,
        );
      },
    );
    return () => {
      unsubscribeBlur();
      unsubscribeRemove();
      appStateSubscription.remove();
    };
  }, [navigation]);
}

export function useChatRuntimeSubscriptions(
): {
  imageGenState: ImageGenerationState;
  isCompacting: boolean;
  queueCount: number;
  queuedTexts: string[];
} {
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState(),
  );
  const [isCompacting, setIsCompacting] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [queuedTexts, setQueuedTexts] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribeImage =
      imageGenerationService.subscribe(setImageGenState);
    const unsubscribeCompaction =
      contextCompactionService.subscribeCompacting(setIsCompacting);
    return () => {
      unsubscribeImage();
      unsubscribeCompaction();
    };
  }, []);

  useEffect(() => {
    return mobileChatSession.subscribeQueue(projection => {
      const queued = projection.entries.filter(entry => entry.status === 'queued');
      setQueueCount(queued.length);
      setQueuedTexts(queued.map(entry => {
        const message = useChatStore.getState()
          .getConversationMessages(entry.conversationId)
          .find(candidate => candidate.id === entry.turnId);
        return message?.content ?? '';
      }));
    });
  }, []);

  return { imageGenState, isCompacting, queueCount, queuedTexts };
}

interface ConversationLifecycleArgs {
  routeConversationId?: string;
  routeProjectId?: string;
  activeConversationId: string | null;
  setActiveConversation: (conversationId: string | null) => void;
  setPendingProjectId: (projectId?: string) => void;
}

export function useChatConversationLifecycle({
  routeConversationId,
  routeProjectId,
  activeConversationId,
  setActiveConversation,
  setPendingProjectId,
}: ConversationLifecycleArgs): void {
  useEffect(() => {
    setActiveConversation(routeConversationId ?? null);
    // The route ID is the owner of this transition; store callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeConversationId]);

  useEffect(() => {
    setPendingProjectId(routeProjectId);
  }, [routeProjectId, setPendingProjectId]);

  useEffect(() => {
    if (
      generationSession.getConversationId() &&
      !generationSession.isGeneratingFor(activeConversationId)
    ) {
      generationSession.end('conversation-switch');
    }
    // Native conversation isolation is awaited by generationService immediately
    // before a local turn starts. A navigation timer here raced the first Send and
    // could clear too late (context leak) or during prefill (no-op).
  }, [activeConversationId]);
}

export function useChatPresentationLifecycle(
  activeConversationId: string | null,
  messageCount: number,
  isStreamingForThisConversation: boolean,
): number {
  const [animateLastN, setAnimateLastN] = useState(0);
  const lastMessageCountRef = useRef(0);
  const previousStreamingRef = useRef(false);

  useEffect(() => {
    const previous = lastMessageCountRef.current;
    if (messageCount > previous && previous > 0) {
      setAnimateLastN(messageCount - previous);
    }
    lastMessageCountRef.current = messageCount;
  }, [messageCount]);

  useEffect(() => {
    lastMessageCountRef.current = 0;
    setAnimateLastN(0);
  }, [activeConversationId]);

  useEffect(() => {
    const wasStreaming = previousStreamingRef.current;
    previousStreamingRef.current = isStreamingForThisConversation;
    if (
      wasStreaming &&
      !isStreamingForThisConversation &&
      activeConversationId
    ) {
      callHook(HOOKS.audioOnStreamingEnd, activeConversationId);
    }
  }, [isStreamingForThisConversation]); // eslint-disable-line react-hooks/exhaustive-deps

  return animateLastN;
}
