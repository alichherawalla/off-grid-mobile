/**
 * One generated-image vocabulary for React Native and Electron.
 *
 * The journey owns product meaning: find the synced chat, observe temporary work, require one final
 * image bubble, then require the image in Gallery. The two adapters below own only UI mechanics.
 */

const LIVE_STATE =
  /enhancing your prompt|loading image model|generating image(?:\s|\.|\(|$)|refining image/i;
const ARRIVING = /image arriving/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasLabel = (labels, wanted) =>
  labels.some((label) => label.toLowerCase().includes(wanted.toLowerCase()));
const hasExactLabel = (labels, wanted) =>
  labels.some((label) => label.trim().toLowerCase() === wanted.toLowerCase());

const nodeFields = (node) =>
  [node?.label, node?.name, node?.value]
    .map((field) => `${field ?? ''}`.trim())
    .filter(Boolean);

/** Return the smallest accessibility subtree that proves prompt + decoded image are one bubble. */
function groupedMobileImage(root, token) {
  let best = null;
  const visit = (node) => {
    if (!node) return { text: '', nodes: 0 };
    const children = (node.children ?? []).map(visit);
    const text = [...nodeFields(node), ...children.map((child) => child.text)].join('\n').toLowerCase();
    const nodes = 1 + children.reduce((sum, child) => sum + child.nodes, 0);
    const isMessage = text.includes('message-bubble') || text.includes('assistant-message');
    const isDecodedImage =
      text.includes('generated-image') && text.includes('generated image loaded');
    if (
      isMessage &&
      isDecodedImage &&
      text.includes(token.toLowerCase()) &&
      !ARRIVING.test(text) &&
      (!best || nodes < best.nodes)
    ) {
      best = { nodes, text };
    }
    return { text, nodes };
  };
  const whole = visit(root).text;
  return {
    grouped: best !== null,
    live: LIVE_STATE.test(whole),
    arriving: ARRIVING.test(whole),
  };
}

function mobileGalleryEntries(root) {
  const entries = [];
  const visit = (node) => {
    if (!node) return;
    const id = nodeFields(node).find((field) => field.startsWith('gallery-image-'));
    if (id) {
      entries.push({
        id,
        loaded: nodeFields(node).some((field) => field.startsWith('Generated image loaded:')),
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return entries;
}

/**
 * Walk to a screen, waiting for it rather than sleeping a fixed amount at it.
 *
 * Six attempts at a flat 700ms was a budget, not a wait. Starting from a long transcript - the
 * guided six-tool chat, say - a single accessibility dump on iOS takes seconds, so the loop spent
 * its whole allowance mid-navigation and failed with "ios could not reach home-screen" while the
 * phone was on its way there and arrived moments later. Same defect as the 500ms sleep at the
 * quick-settings sheet: a timing artefact wearing a capability error's clothes.
 */
async function openMobileScreen(ui, { tab, screen, platform }) {
  const arrived = async (timeoutMs) =>
    ui
      .waitFor(async () => hasLabel(await ui.labels(), screen), {
        label: `${platform} ${screen}`,
        timeoutMs,
        intervalMs: 500,
      })
      .then(() => true)
      .catch(() => false);

  if (await arrived(2_000)) return;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const labels = await ui.labels();
    if (hasLabel(labels, screen)) return;
    if (hasLabel(labels, tab)) {
      await ui.tapLabel(tab);
    } else if (hasExactLabel(labels, 'Back')) {
      await ui.tapLabel('Back');
    } else if (hasExactLabel(labels, 'Close gallery')) {
      await ui.tapLabel('Close gallery');
    } else {
      await ui.back().catch(() => undefined);
    }
    if (await arrived(6_000)) return;
  }
  throw new Error(`${platform} could not reach ${screen}`);
}

function reactNativeGeneratedImageSurface(surface) {
  const { ui, platform } = surface;

  const openChats = () =>
    openMobileScreen(ui, { tab: 'chats-tab', screen: 'conversation-list', platform });
  const openHome = () =>
    openMobileScreen(ui, { tab: 'home-tab', screen: 'home-screen', platform });

  return {
    platform,
    family: surface.family,

    async galleryBaseline() {
      await openHome();
      await ui.scrollAndTap('Image Gallery', { maxSwipes: 10 });
      await ui.waitForLabel('gallery-screen', { label: `${platform} Gallery`, timeoutMs: 30_000 });
      const baseline = mobileGalleryEntries(await ui.source()).map((entry) => entry.id);
      const labels = await ui.labels();
      if (hasExactLabel(labels, 'Close gallery')) await ui.tapLabel('Close gallery');
      else await ui.back();
      await ui.waitForLabel('home-screen', { label: `${platform} home`, timeoutMs: 30_000 });
      return baseline;
    },

    async prepareForIncoming() {
      await openChats();
    },

    async openIncomingConversation(token, timeoutMs) {
      await ui.waitForLabel(token, {
        label: `${platform} chat preview for ${token}`,
        timeoutMs,
        intervalMs: 1000,
      });
      await ui.tapWhenReady(token, { timeoutMs: 10_000 });
      await ui.waitForLabel('chat-screen', {
        label: `${platform} synced chat`,
        timeoutMs: 30_000,
      });
    },

    /**
     * Both phones run the same React Native tree with the same testIDs, so producing an image is one
     * journey - only the driver differs, and that is settled a layer below. The Android-only guard
     * here was the last thing pinning this route to one device.
     */
    async startGeneration(prompt, { enhancement } = {}) {
      await openHome();
      await ui.tapWhenReady('new-chat-button', { timeoutMs: 30_000 });
      await ui.waitForLabel('chat-screen', {
        label: `the new ${platform} chat`,
        timeoutMs: 30_000,
      });
      // The sheet is a TOGGLE: tapping it when it is already open closes it, and the run then waits
      // for a control that just disappeared. Open it only when it is not already showing.
      if (!hasLabel(await ui.labels(), 'quick-image-mode')) {
        await ui.tapWhenReady('quick-settings-button', { timeoutMs: 20_000 });
      }
      await ui.waitForLabel('quick-image-mode', {
        label: `${platform} Image Gen mode`,
        timeoutMs: 20_000,
      });
      if (!hasLabel(await ui.labels(), 'image-mode-force-badge')) {
        await ui.tapLabel('quick-image-mode');
      }
      await ui.waitForLabel('image-mode-force-badge', {
        label: `${platform} forced image mode`,
        timeoutMs: 20_000,
      });
      // Close the sheet the way it was opened. iOS has no hardware back, and its edge-swipe leaves
      // the sheet up - the composer underneath is then unreachable. Then WAIT for it to actually be
      // gone: the next tap fires immediately after, and one aimed at chat-settings-icon while the
      // sheet is still animating away is swallowed, so the modal never opens and the run waits 20s
      // for it. Enhancement OFF happened to win that race; ON lost it.
      if (hasLabel(await ui.labels(), 'quick-image-mode')) {
        await ui.tapLabel('quick-settings-button');
        await ui
          .waitFor(async () => !hasLabel(await ui.labels(), 'quick-image-mode'), {
            label: `${platform} quick settings sheet closed`,
            timeoutMs: 10_000,
            intervalMs: 400,
          })
          .catch(() => undefined);
      }
      // Enhancement is set HERE, not before: its controls live in the in-chat settings modal behind
      // chat-settings-icon, which does not exist until this chat does. Setting it first failed with
      // "waiting for an element labelled chat-settings-icon" on a phone still sitting on Home.
      if (enhancement) await this.setEnhancement(enhancement);
      await ui.tapWhenReady('chat-input', { timeoutMs: 20_000 });
      await ui.type(prompt);
      await ui.tapWhenReady('send-button', { timeoutMs: 20_000 });
    },

    /**
     * Prompt enhancement on or off, through the controls a person uses.
     *
     * These live in the FULL generation-settings modal behind the top-right icon, not the quick
     * panel beside the input, and the enhance choice sits behind the modal's Advanced section.
     * prepare-image-settings.mjs already drives exactly these testIDs - it just reaches them with
     * adb + Appium, which is what made it Android-only.
     */
    async setEnhancement(enhancement) {
      if (!['on', 'off'].includes(enhancement)) {
        throw new Error(`enhancement must be on or off, got ${enhancement}`);
      }
      // Open the settings modal, and if the tap was swallowed, try once more rather than waiting out
      // the whole timeout on a screen where nothing was ever opened.
      const settingsOpen = async (timeoutMs) =>
        ui
          .waitFor(async () => hasLabel(await ui.labels(), 'modal-image-accordion'), {
            label: `${platform} in-chat generation settings`,
            timeoutMs,
            intervalMs: 500,
          })
          .then(() => true)
          .catch(() => false);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (await settingsOpen(0)) break;
        await ui.tapWhenReady('chat-settings-icon', { timeoutMs: 20_000 });
        if (await settingsOpen(10_000)) break;
        if (attempt === 2) {
          throw new Error(
            `${platform} did not open the in-chat generation settings after two taps`,
          );
        }
      }
      await ui.tapLabel('modal-image-accordion');
      await ui.waitForLabel('modal-image-advanced-toggle', {
        label: `${platform} image section open`,
        timeoutMs: 20_000,
      });
      await ui.tapLabel('modal-image-advanced-toggle');
      // A plain scroll inside a modal, then a plain tap: scrollAndTap swipes, and a swipe on a sheet
      // can dismiss it rather than scroll it.
      await ui.scrollToLabel(`image-enhance-${enhancement}`, { maxSwipes: 8 });
      await ui.tapLabel(`image-enhance-${enhancement}`);

      // Leave by a real control, never a blind gesture, and confirm the state reached.
      for (const control of ['modal-close', 'Done', 'Close']) {
        if (hasExactLabel(await ui.labels(), control)) {
          await ui.tapLabel(control);
          break;
        }
      }
      if (!hasLabel(await ui.labels(), 'chat-screen')) await ui.back();
      await ui.waitForLabel('chat-screen', {
        label: `${platform} chat after setting enhancement ${enhancement}`,
        timeoutMs: 20_000,
      });
      return enhancement;
    },

    async waitForLiveState(timeoutMs) {
      return ui.waitFor(
        async () => {
          const match = (await ui.labels()).find((label) => LIVE_STATE.test(label));
          return match || false;
        },
        { label: `${platform} live image state`, timeoutMs, intervalMs: 1000 },
      );
    },

    async waitForFinal(token, timeoutMs) {
      return ui.waitFor(
        async () => {
          const result = groupedMobileImage(await ui.source(), token);
          return result.grouped && !result.live && !result.arriving ? result : false;
        },
        {
          label: `${platform} grouped decoded image for ${token}`,
          timeoutMs,
          intervalMs: 2000,
        },
      );
    },

    async verifyGallery(_token, baseline, timeoutMs) {
      await openHome();
      await ui.scrollAndTap('Image Gallery', { maxSwipes: 10 });
      await ui.waitForLabel('gallery-screen', { label: `${platform} Gallery`, timeoutMs: 30_000 });
      return ui.waitFor(
        async () => {
          const before = new Set(baseline ?? []);
          return (
            mobileGalleryEntries(await ui.source()).find(
              (entry) => !before.has(entry.id) && entry.loaded,
            ) || false
          );
        },
        { label: `${platform} new loaded Gallery image`, timeoutMs, intervalMs: 2000 },
      );
    },

    screenshot: (path) => surface.screenshot(path),
    close: () => surface.close(),
  };
}

function electronGeneratedImageSurface(surface) {
  const { ui, platform } = surface;

  const ensureHistory = () =>
    ui.waitFor(
      async () =>
        ui.evaluate(`
          const history = document.querySelector('aside');
          if (history && history.offsetParent !== null) return true;
          const chat = [...document.querySelectorAll('button')].find(
            (button) => button.offsetParent !== null && button.innerText.trim() === 'Chat',
          );
          if (chat && !location.pathname.endsWith('/chat')) {
            chat.click();
            return false;
          }
          const button = document.querySelector('button[title="Show conversations"]');
          if (!button || button.offsetParent === null) return false;
          button.click();
          return false;
        `),
      { label: `${platform} conversation history`, timeoutMs: 20_000, intervalMs: 500 },
    );

  return {
    platform,
    family: surface.family,

    async galleryBaseline() {
      return ui.evaluate(`
        return Promise.resolve(window.api.listGeneratedImages?.())
          .then((images) => (images ?? []).map((image) => image.path));
      `);
    },

    async prepareForIncoming() {
      await ensureHistory();
    },

    async openIncomingConversation(token, timeoutMs) {
      await ui.waitFor(
        async () =>
          ui.evaluate(`
            const wanted = ${JSON.stringify(token)}.toLowerCase();
            const aside = document.querySelector('aside');
            if (!aside || aside.offsetParent === null) return false;
            const row = [...aside.querySelectorAll('div.cursor-pointer')]
              .filter((element) => (element.innerText ?? '').toLowerCase().includes(wanted))
              .filter((element) => element.offsetParent !== null)
              .sort((a, b) => a.innerText.length - b.innerText.length)[0];
            if (!row) return false;
            row.click();
            return true;
          `),
        { label: `${platform} chat preview for ${token}`, timeoutMs, intervalMs: 1000 },
      );
      await ui.waitFor(
        async () =>
          ui.evaluate(`
            const wanted = ${JSON.stringify(token)}.toLowerCase();
            return [...document.querySelectorAll('[data-testid^="chat-message-"]')]
              .some((row) => (row.innerText ?? '').toLowerCase().includes(wanted));
          `),
        { label: `${platform} synced user message`, timeoutMs: 30_000, intervalMs: 750 },
      );
    },

    async startGeneration() {
      throw new Error('this route starts image generation on Android');
    },

    async waitForLiveState(timeoutMs) {
      return ui.waitFor(
        async () =>
          ui.evaluate(`
            const row = document.querySelector('[data-testid="remote-chat-preview"]');
            const text = row?.innerText ?? '';
            return row && ${LIVE_STATE}.test(text) ? text.trim() : false;
          `),
        { label: `${platform} live image state`, timeoutMs, intervalMs: 750 },
      );
    },

    async waitForFinal(token, timeoutMs) {
      return ui.waitFor(
        async () =>
          ui.evaluate(`
            const wanted = ${JSON.stringify(token)}.toLowerCase();
            const rows = [...document.querySelectorAll('[data-testid^="chat-message-"]')]
              .filter((row) => (row.innerText ?? '').toLowerCase().includes(wanted))
              .filter((row) => {
                const image = row.querySelector('img');
                return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
              });
            const chatText = [...document.querySelectorAll('[data-testid^="chat-message-"]')]
              .map((row) => row.innerText ?? '')
              .join('\\n');
            if (
              rows.length !== 1 ||
              document.querySelector('[data-testid="remote-chat-preview"]') ||
              ${ARRIVING}.test(chatText)
            ) return false;
            const image = rows[0].querySelector('img');
            return {
              rows: rows.length,
              width: image.naturalWidth,
              height: image.naturalHeight,
              decoded: true,
            };
          `),
        { label: `${platform} grouped decoded image for ${token}`, timeoutMs, intervalMs: 2000 },
      );
    },

    async verifyGallery(_token, baseline, timeoutMs) {
      const fresh = await ui.waitFor(
        async () =>
          ui.evaluate(`
            const before = new Set(${JSON.stringify(baseline ?? [])});
            return Promise.resolve(window.api.listGeneratedImages?.()).then((images) => {
              const added = (images ?? []).filter((image) => !before.has(image.path));
              return added.length > 0 ? added : false;
            });
          `),
        { label: `${platform} Gallery metadata`, timeoutMs, intervalMs: 2000 },
      );
      const opened = await ui.evaluate(`
        const button = document.querySelector('button[title="Generated images"]');
        if (!button || button.offsetParent === null) return false;
        button.click();
        return true;
      `);
      if (!opened) throw new Error(`${platform} shows no Generated images control`);
      return ui.waitFor(
        async () =>
          ui.evaluate(`
            const names = new Set(${JSON.stringify(fresh.map((image) => image.name))});
            const image = [...document.images].find(
              (candidate) => names.has(candidate.alt) && candidate.offsetParent !== null,
            );
            return image?.complete && image.naturalWidth > 0
              ? { name: image.alt, width: image.naturalWidth, height: image.naturalHeight }
              : false;
          `),
        { label: `${platform} loaded Gallery image`, timeoutMs, intervalMs: 1000 },
      );
    },

    screenshot: (path) => surface.screenshot(path),
    close: () => surface.close(),
  };
}

export function generatedImageSurface(surface) {
  if (surface.family === 'rn') return reactNativeGeneratedImageSurface(surface);
  if (surface.family === 'electron') return electronGeneratedImageSurface(surface);
  throw new Error(`unsupported generated-image surface family "${surface.family}"`);
}
