import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Tracks how much of the screen the on-screen keyboard covers, in points.
 *
 * [[useKeyboardVisible]] answers whether the keyboard is up, which is enough to hide a control but
 * not to move one out from under it. A sheet whose action sits below a multiline field needs the
 * HEIGHT: a multiline field has no return key to dismiss with, and a modal sheet has nowhere to tap
 * that resigns the field, so an action left under the keyboard cannot be reached at all - the form
 * simply cannot be submitted.
 *
 * Uses the `will*` events on iOS so layout changes travel with the keyboard animation rather than
 * snapping after it, and `did*` on Android, which has no `will*` events. Same Platform branch as
 * [[useKeyboardVisible]], and for the same reason: it picks event names, not layout values.
 */
export const useKeyboardHeight = (): number => {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvt =
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvt =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, event => {
      setHeight(event?.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
};
