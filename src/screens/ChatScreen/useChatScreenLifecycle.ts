import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { NavigationProp } from '@react-navigation/native';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  contextCompactionService,
  generationService,
  imageGenerationService,
  ImageGenerationState,
  llmService,
  QueuedMessage,
} from '../../services';
import { generationSession } from '../../services/generationSession';
import type { RootStackParamList } from '../../navigation/types';
import {
  dispatchGenerationFn,
  GenerationDeps,
} from './useChatGenerationActions';

type StartGeneration = (
  conversationId: string,
  text: string,
) => Promise<void>;

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
  generationDepsRef: MutableRefObject<GenerationDeps | null>,
  startGenerationRef: MutableRefObject<StartGeneration | null>,
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

  useEffect(
    () =>
      generationService.subscribe(state => {
        setQueueCount(state.queuedMessages.length);
        setQueuedTexts(
          state.queuedMessages.map((message: QueuedMessage) => message.text),
        );
      }),
    [],
  );

  const handleQueuedSend = useCallback(
    async (item: QueuedMessage) => {
      if (!generationDepsRef.current || !startGenerationRef.current) return;
      await dispatchGenerationFn(
        generationDepsRef.current,
        {
          text: item.text,
          attachments: item.attachments,
          conversationId: item.conversationId,
          imageMode: item.imageMode,
        },
        startGenerationRef.current,
      );
    },
    [generationDepsRef, startGenerationRef],
  );

  useEffect(() => {
    generationService.setQueueProcessor(handleQueuedSend);
    return () => generationService.setQueueProcessor(null);
  }, [handleQueuedSend]);

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
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled && llmService.isModelLoaded()) {
        llmService.clearKVCache(false).catch(() => {});
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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
