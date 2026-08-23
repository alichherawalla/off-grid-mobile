/**
 * Put Android in a known IMAGE-GENERATION state before a mesh journey.
 *
 * The image journey used to start in whatever state the app happened to be in, so a slow run and a
 * fast one were not the same test and neither could be compared to the last. This sets the four
 * things that decide what the run actually exercises, through the real controls a person uses:
 *
 *   steps          maximum, so the run is the long path rather than the 4-step preview
 *   size           512, the detailed output rather than the 256 sweet spot
 *   GPU            on, because a CPU-only run is a different engine path entirely
 *   enhancement    off or on, chosen per run - it adds a whole model pass before the image
 *
 * Values are TYPED into each slider's value field rather than dragged: a drag lands wherever the
 * gesture ends, which is how a "maximum steps" run quietly becomes a 47-step one.
 *
 * Driven through Appium rather than `uiautomator dump`. The dump serialises the WHOLE hierarchy in
 * one shot and is killed outright on a long transcript - the exact chat an image journey runs in -
 * so every label lookup misses and the failure reads as "the app has no home screen". Appium's
 * server queries element by element and survives it.
 *
 *   node scripts/e2e/prepare-image-settings.mjs --enhancement off
 *   node scripts/e2e/prepare-image-settings.mjs --enhancement on --fresh-chat false
 */
import { AdbClient } from '../android/adb-client.mjs';
import { AppiumAndroidClient } from '../android/appium-client.mjs';
import { flag } from './mesh-config.mjs';

const MAX_IMAGE_STEPS = 50;
const IMAGE_SIZE = 512;

const enhancement = flag('enhancement', 'off').toLowerCase();
if (!['on', 'off'].includes(enhancement)) {
  throw new Error('--enhancement must be on or off');
}
const freshChat = flag('fresh-chat', 'true') === 'true';
const serial = flag('android', '505b53a0');
const appiumUrl = flag('appium', process.env.APPIUM_URL ?? 'http://127.0.0.1:4723');
const packageName = flag('package', 'ai.offgridmobile.dev');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = new AdbClient(serial);
const appium = new AppiumAndroidClient(appiumUrl, serial);

/** Wait for a control to exist, asking Appium one element at a time. */
const waitFor = async (testId, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await appium.findByTestId(testId);
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${testId}: ${error.message}`);
      }
      await sleep(700);
    }
  }
};

const tap = async (testId, timeoutMs = 30_000) => {
  await waitFor(testId, timeoutMs);
  await appium.clickTestId(testId);
  await sleep(500);
};

/**
 * Bring a control into view, then answer with it.
 *
 * A long settings sheet does not RENDER its off-screen rows, so a control below the fold is absent
 * from the hierarchy rather than merely invisible - and "not found" reads as "this build has no GPU
 * switch". Swiping is what makes it exist.
 */
const scrollTo = async (testId, swipes = 8) => {
  for (let attempt = 0; attempt <= swipes; attempt += 1) {
    if (await has(testId)) return;
    await adb.shell('input swipe 540 1700 540 900 250');
    await sleep(700);
  }
  throw new Error(`${testId} never came into view after ${swipes} swipes`);
};

/** Present, or not - used where a control is optional rather than awaited. */
const has = async (testId) => {
  try {
    await appium.findByTestId(testId);
    return true;
  } catch {
    return false;
  }
};

/** Set a slider by typing its value, so the run gets the number this asked for. */
const setSlider = async (testId, value) => {
  await scrollTo(`${testId}-value-button`);
  await tap(`${testId}-value-button`);
  await appium.replaceTestId(`${testId}-input`, String(value));
  // Commit it. The field only becomes the readable value again once it submits or blurs, so
  // without this the check below reads an empty string off a control still being edited.
  await adb.shell('input keyevent 66');
  await sleep(900);
  // Read the value BACK off the control, so a field that silently refused the number fails here
  // rather than three minutes later as a run that used the wrong settings.
  const shown = await appium.textTestId(`${testId}-value`).catch(() => '');
  if (!shown.includes(String(value))) {
    throw new Error(`${testId} shows "${shown}" after being set to ${value}`);
  }
  console.log(`SET   ${testId} = ${value} (reads "${shown}")`);
};

const stateOf = async (testId, name) => {
  await waitFor(testId);
  const checked = await appium.attributeTestId(testId, 'checked');
  if (checked === 'true' || checked === true) return true;
  if (checked === 'false' || checked === false) return false;
  throw new Error(`${name} exposes no checked state (saw ${JSON.stringify(checked)})`);
};

const ensureToggle = async (testId, name, wanted) => {
  if ((await stateOf(testId, name)) === wanted) {
    console.log(`KEEP  ${name} already ${wanted ? 'ON' : 'OFF'}`);
    return;
  }
  await tap(testId);
  await sleep(800);
  if ((await stateOf(testId, name)) !== wanted) {
    throw new Error(`${name} did not reach ${wanted ? 'ON' : 'OFF'}`);
  }
  console.log(`SET   ${name} = ${wanted ? 'ON' : 'OFF'}`);
};

await adb.session(packageName);
await appium.session();

if (freshChat) {
  // Back out of whatever chat the app reopened into. A fresh chat is also a SHORT transcript, which
  // is what keeps the rest of this readable to the driver.
  for (let attempt = 0; attempt < 6 && !(await has('home-screen')); attempt += 1) {
    await appium.back?.().catch(() => undefined);
    await adb.back().catch(() => undefined);
    await sleep(900);
  }
  await tap('new-chat-button', 40_000);
  await waitFor('chat-screen', 30_000);
  console.log('OPEN  a new chat');
}

// Top-right, not the quick panel beside the input: the quick one carries Thinking and the tool
// badges, and the image controls live in the full generation-settings modal behind this icon.
await tap('chat-settings-icon');
await waitFor('modal-image-accordion', 20_000);
console.log('OPEN  in-chat settings');

// The image controls live behind their own section, and the GPU switch behind Advanced inside it.
await tap('modal-image-accordion');
await sleep(600);

await setSlider('image-steps', MAX_IMAGE_STEPS);
await setSlider('image-size', IMAGE_SIZE);

await scrollTo('modal-image-advanced-toggle');
await tap('modal-image-advanced-toggle');
await sleep(600);
await scrollTo('image-gpu-acceleration');
await ensureToggle('image-gpu-acceleration', 'GPU Acceleration', true);

await scrollTo(`image-enhance-${enhancement}`);
await tap(`image-enhance-${enhancement}`);
console.log(`SET   prompt enhancement = ${enhancement.toUpperCase()}`);

await adb.back();
await waitFor('chat-screen', 20_000);
await appium.close().catch(() => undefined);
console.log(
  `PASS  android  steps=${MAX_IMAGE_STEPS} size=${IMAGE_SIZE} GPU=ON enhancement=${enhancement.toUpperCase()}`,
);
