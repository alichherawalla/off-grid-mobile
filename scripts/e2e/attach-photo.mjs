/**
 * Attach the newest photo on this Android device to the open chat, through the real picker.
 *
 * The app has no ACTION_SEND filter and no deep link that carries an image, so the ONLY way a photo
 * reaches a message is the way a person does it: the composer's plus, the app's image-source sheet,
 * and Android's system photo picker. That picker is a different application - `com.google.android
 * .photopicker`, with its own view tree and none of our testIDs - so it is named by what Android
 * itself exposes, and the newest item is chosen by position rather than by guessing a filename.
 *
 * Answers the attachment id it added, so a caller can prove the composer actually took it.
 *
 *   node scripts/e2e/attach-photo.mjs
 */
import { AppiumAndroidClient } from '../android/appium-client.mjs';
import { flag } from './mesh-config.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The newest photo, by grid position. Its content-desc carries the date, not a stable name. */
const NEWEST_PHOTO = '(//*[starts-with(@content-desc,"Photo taken on")])[1]';

/**
 * Wait for a control, then click it.
 *
 * Every step here crosses a boundary that takes its own time - a sheet animating in, then a second
 * sheet, then a whole other application launching - so a fixed sleep is a guess that fails on the
 * one run where the device is busy. Waiting for the thing itself is the only honest timing.
 */
const clickWhenReady = async (appium, expression, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await appium.clickByXPath(expression);
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${expression}: ${error.message}`);
      }
      await sleep(600);
    }
  }
};

export async function attachNewestPhoto(appium) {
  await appium.clickTestId('attach-button');
  // The app's own sheet first: Photo or Document.
  await clickWhenReady(appium, '//*[@text="Photo"]');
  // Then its image-source sheet: Camera or Photo Library.
  await clickWhenReady(appium, '//*[@text="Photo Library"]');
  // The system picker is a separate application and takes the longest to appear.
  await clickWhenReady(appium, NEWEST_PHOTO, 40_000);
  // Single-select still requires confirming, and the picker owns this button.
  await clickWhenReady(appium, '//*[@text="Done" or @content-desc="Done"]');
  await sleep(3000);

  // The composer is the only place that can say the attachment arrived. An id here means a real
  // MediaAttachment was created from the picked uri, not merely that the picker closed.
  // Give the composer a moment to turn the picked uri into a real MediaAttachment before deciding
  // it failed to: the picker closing and the preview appearing are not the same instant.
  const deadline = Date.now() + 20_000;
  for (;;) {
    const source = await appium.source();
    const id = /resource-id="attachment-preview-([^"]+)"/.exec(source)?.[1];
    if (id) return id;
    if (Date.now() >= deadline) {
      throw new Error('the composer shows no attachment after the picker closed');
    }
    await sleep(700);
  }
}

// Runnable on its own, so the attach path can be exercised without a whole journey.
if (import.meta.url === `file://${process.argv[1]}`) {
  const appium = new AppiumAndroidClient(
    flag('appium', process.env.APPIUM_URL ?? 'http://127.0.0.1:4723'),
    flag('android', '505b53a0'),
  );
  await appium.session();
  const id = await attachNewestPhoto(appium);
  await appium.close().catch(() => undefined);
  console.log(`PASS  android  attached the newest photo (${id})`);
}
