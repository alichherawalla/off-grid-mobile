/**
 * The Android half of a mesh journey: get somewhere known, start a turn, send it.
 *
 * Extracted because every journey that PRODUCES from this phone needs the same four moves, and each
 * one has a device-learned reason behind it that is expensive to rediscover:
 *
 *   - Appium and `adb shell uiautomator dump` cannot both own UiAutomator. The device runs ONE
 *     instance, so an open Appium session makes every adb dump fail, and the failure reads as a
 *     wedged phone rather than a driver collision. Callers hold the session only while they need it.
 *   - Pressing back until a screen appears walks straight OUT of the app and onto the launcher,
 *     where none of its screens exist and every further press is wasted.
 *   - A long transcript is unreadable to the dump, so a journey starts from a fresh chat.
 */
import { flag } from './mesh-config.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const androidPackage = () => flag('package', 'ai.offgridmobile.dev');

/** Present, or not. Appium answers this even where the adb dump cannot. */
export const present = async (appium, testId) => {
  try {
    await appium.findByTestId(testId);
    return true;
  } catch {
    return false;
  }
};

export const waitForControl = async (appium, testId, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await present(appium, testId))) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${testId}`);
    await sleep(700);
  }
};

/**
 * Bring the app forward and reach its home screen.
 *
 * Relaunches FIRST: back-pressing an app that has already exited just walks the launcher.
 */
export const reachHome = async (adb, appium, { cold = false } = {}) => {
  // A COLD start unloads the model, which is the only way to exercise the loading phase: a warm
  // device sends `thinking` from the first frame and a peer has nothing to show but "Thinking...".
  // So whether the load is visible at all is a property of how the run STARTS, not of luck.
  if (cold) await adb.restart(androidPackage());
  else await adb.session(androidPackage());
  await sleep(cold ? 12_000 : 3000);
  for (let attempt = 0; attempt < 8 && !(await present(appium, 'home-screen')); attempt += 1) {
    await adb.back().catch(() => undefined);
    await sleep(900);
    if (
      !(await present(appium, 'home-screen')) &&
      !(await present(appium, 'chat-screen'))
    ) {
      await adb.session(androidPackage()).catch(() => undefined);
      await sleep(2000);
    }
  }
  if (!(await present(appium, 'home-screen'))) {
    throw new Error('Android would not return to its home screen');
  }
};

/** A fresh chat, which is also a SHORT transcript - the only kind the adb dump can read. */
export const openNewChat = async (appium) => {
  await waitForControl(appium, 'new-chat-button', 40_000);
  await appium.clickTestId('new-chat-button');
  await waitForControl(appium, 'chat-screen', 30_000);
};

/**
 * Type and send, and do not return until the device SHOWS the turn.
 *
 * A click that lands on a disabled control is silent; the user message appearing is the only proof
 * the turn actually started.
 */
export const sendPrompt = async (appium, prompt, token) => {
  await appium.replaceTestId('chat-input', prompt);
  await sleep(500);
  await appium.clickTestId('send-button');
  const deadline = Date.now() + 60_000;
  for (;;) {
    const source = await appium.source();
    if (source.includes(token)) return;
    if (Date.now() >= deadline) {
      throw new Error(`the turn for ${token} never appeared on Android`);
    }
    await sleep(800);
  }
};
