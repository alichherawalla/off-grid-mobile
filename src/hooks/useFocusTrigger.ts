import { useRef, useEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';

/**
 * Returns a number that increments each time the screen gains focus.
 * Pass this as `trigger` to AnimatedEntry / AnimatedListItem to replay
 * stagger animations on every tab visit.
 */
export function useFocusTrigger(): number {
  const isFocused = useIsFocused();
  const count = useRef(0);

  useEffect(() => {
    if (isFocused) {
      count.current += 1;
    }
  }, [isFocused]);

  return count.current;
}
