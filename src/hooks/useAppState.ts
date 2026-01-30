import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export interface UseAppStateCallbacks {
  onForeground?: () => void;
  onBackground?: () => void;
}

export const useAppState = (callbacks: UseAppStateCallbacks) => {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        callbacks.onForeground?.();
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        callbacks.onBackground?.();
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [callbacks]);

  return {
    currentState: appState.current,
  };
};
