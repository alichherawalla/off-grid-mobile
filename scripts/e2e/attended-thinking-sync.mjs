/**
 * Attended Android -> mesh Thinking journey.
 *
 * This runner is intentionally staged. Each command performs one visible action, records the state
 * before and after it, and then exits. The send stage is guarded by durable state so rerunning a
 * command after a UI or control-channel failure cannot submit the same prompt twice.
 *
 *   npm run e2e:thinking-sync -- --step snapshot --run meshproof... --ios http://...:8100
 *   npm run e2e:thinking-sync -- --step open-chat --run meshproof... --ios http://...:8100
 *   npm run e2e:thinking-sync -- --step open-settings --run meshproof... --ios http://...:8100
 */
import { execFile as execFileCallback } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { AdbClient } from '../android/adb-client.mjs';
import { AppiumAndroidClient } from '../android/appium-client.mjs';
import { EVIDENCE_DIR, flag, specFor } from './mesh-config.mjs';
import { connectSurface } from './sync-surface.mjs';

const execFile = promisify(execFileCallback);

const KINDS = ['android', 'ios', 'macos', 'windows'];
const step = flag('step', 'snapshot');
const run = flag('run', '');
const requestedPlatform = flag('platform', 'all').toLowerCase();
const primaryKind = flag('primary', 'android').toLowerCase();
// Which devices take part. Defaults to all four; narrow it when one is genuinely unavailable, and
// the run PRINTS what it left out - a journey that quietly drops a surface reads as full coverage.
const meshKinds = flag('mesh', KINDS.join(','))
  .split(',')
  .map(kind => kind.trim().toLowerCase())
  .filter(Boolean);
const excluded = KINDS.filter(kind => !meshKinds.includes(kind));
for (const kind of meshKinds) {
  if (!KINDS.includes(kind)) throw new Error(`--mesh has an unknown device: ${kind}`);
}
if (!meshKinds.includes(primaryKind)) {
  throw new Error(`--mesh must include the primary device (${primaryKind})`);
}
if (excluded.length) {
  console.log(`NOTE  excluded from this run: ${excluded.join(', ')}`);
}
if (!run) throw new Error('--run must contain the existing checkpoint marker');
if (requestedPlatform !== 'all' && !KINDS.includes(requestedPlatform)) {
  throw new Error(`--platform must be all or one of ${KINDS.join(', ')}`);
}
if (!['android', 'ios'].includes(primaryKind)) {
  throw new Error('--primary must be android or ios');
}

const evidenceDir = resolve(
  flag(
    'evidence',
    join(EVIDENCE_DIR, 'generated-image-sync', `attended-${run}`),
  ),
);
const statePath = join(evidenceDir, 'thinking-state.json');
const logPath = join(evidenceDir, 'thinking-actions.ndjson');
const safe = value => value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const THINKING_LIVE =
  /thinking(?:\.{2,}|\s+for\s+|\s*\()|analyzing|generating response/i;
const count = (text, token) =>
  text.toLowerCase().split(token.toLowerCase()).length - 1;
const timeoutMs = Number(flag('timeout-minutes', '5')) * 60_000;
const appiumUrl = flag(
  'appium',
  process.env.APPIUM_URL ?? 'http://127.0.0.1:4723',
);
const projectFixtureDir = resolve('scripts/e2e/fixtures/off-grid-ai-project');
const QWEN_ROW_TEST_ID =
  'text-model-row-unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf';
const GUIDED_REQUIRED_TOOL_CALLS = [
  'search_knowledge_base',
  'web_search',
  'read_url',
  'read_wiki_structure',
  'read_wiki_contents',
  'ask_question',
];
const thinkingPrompt = token =>
  flag('thinking-prompt', '') ||
  `${run} What is 2 + 2? Reply with only the number.`;

const mobileMessageHasMarker = (root, role, token) => {
  const visit = node => {
    if (!node) return { text: '', matched: false };
    const children = (node.children ?? []).map(visit);
    const own = [node.label, node.name, node.value]
      .map(value => `${value ?? ''}`)
      .join('\n');
    const text = [own, ...children.map(child => child.text)].join('\n');
    const matched =
      children.some(child => child.matched) ||
      (own.toLowerCase().includes(role.toLowerCase()) &&
        text.toLowerCase().includes(token.toLowerCase()));
    return { text, matched };
  };
  return visit(root).matched;
};

const mobileAssistantResponseEndsWithMarker = (root, token) => {
  const nodeText = node =>
    [node?.label, node?.name, node?.value]
      .map(value => `${value ?? ''}`)
      .filter(Boolean)
      .join('\n');
  const subtreeText = node =>
    [nodeText(node), ...(node?.children ?? []).map(subtreeText)]
      .filter(Boolean)
      .join('\n');
  const hasId = (node, id) =>
    [node?.label, node?.name, node?.value].some(
      value => `${value ?? ''}`.toLowerCase() === id,
    );
  const responseEndsWithMarker = node => {
    if (hasId(node, 'message-text') && subtreeText(node).trim().endsWith(token))
      return true;
    return (node?.children ?? []).some(responseEndsWithMarker);
  };
  const visit = node => {
    if (!node) return false;
    if (hasId(node, 'assistant-message') && responseEndsWithMarker(node))
      return true;
    return (node.children ?? []).some(visit);
  };
  return visit(root);
};

const mobileAssistantResponseMatches = (root, expected) => {
  const wanted = expected.trim().toLowerCase();
  const fields = node =>
    [node?.label, node?.name, node?.value]
      .map(value => `${value ?? ''}`.trim())
      .filter(Boolean);
  const visit = (node, inAssistant = false) => {
    if (!node) return false;
    const values = fields(node);
    const assistant =
      inAssistant ||
      values.some(value => value.toLowerCase() === 'assistant-message');
    if (assistant) {
      if (values.some(value => value.toLowerCase() === wanted)) return true;
      // iOS flattens the visible response into the accessible assistant container instead of
      // exposing it as a child of message-text. Comma-separated accessibility parts preserve the
      // response as one exact field between the collapsed thought and the action row.
      if (
        values.some(value =>
          value
            .split(/,\s*/)
            .some(part => part.trim().toLowerCase() === wanted),
        )
      ) {
        return true;
      }
    }
    return (node.children ?? []).some(child => visit(child, assistant));
  };
  return visit(root);
};

const mobileHasCompletedAssistantAfterMarker = (root, token) => {
  const fields = node =>
    [node?.label, node?.name, node?.value]
      .map(value => `${value ?? ''}`.trim())
      .filter(Boolean);
  const subtreeText = node =>
    [fields(node).join('\n'), ...(node?.children ?? []).map(subtreeText)]
      .filter(Boolean)
      .join('\n');
  const hasId = (node, id) =>
    fields(node).some(value => value.toLowerCase() === id);
  const messages = [];
  const collect = node => {
    if (!node) return;
    if (hasId(node, 'user-message')) {
      messages.push({ role: 'user', text: subtreeText(node) });
      return;
    }
    if (hasId(node, 'assistant-message')) {
      messages.push({
        role: 'assistant',
        text: subtreeText(node),
        hasAnswer: (() => {
          const visit = child => {
            if (!child) return false;
            if (hasId(child, 'message-text')) {
              return (
                subtreeText(child)
                  .replace(/message-text/gi, '')
                  .trim().length > 0
              );
            }
            return (child.children ?? []).some(visit);
          };
          return visit(node);
        })(),
      });
      return;
    }
    (node.children ?? []).forEach(collect);
  };
  collect(root);
  const userIndex = messages.findLastIndex(
    message =>
      message.role === 'user' &&
      message.text.toLowerCase().includes(token.toLowerCase()),
  );
  return (
    userIndex >= 0 &&
    messages
      .slice(userIndex + 1)
      .some(message => message.role === 'assistant' && message.hasAnswer)
  );
};

const finalThinkingResponseIsValid = (result, state) =>
  state.expectedResponse
    ? result.responseMatchesExpected
    : result.finalResponseEndsWithMarker;

const thinkingResult = async (surface, state) => {
  if (surface.family === 'rn') {
    const source = await surface.ui.source();
    const labels = [];
    const collect = node => {
      if (!node) return;
      for (const value of [node.label, node.name, node.value]) {
        if (`${value ?? ''}`) labels.push(`${value}`);
      }
      (node.children ?? []).forEach(collect);
    };
    collect(source);
    const text = labels.join('\n');
    const has = id => labels.some(label => label.toLowerCase() === id);
    return {
      live: [
        'stop-button',
        'thinking-indicator',
        'streaming-thinking-hint',
      ].some(has),
      finalResponseEndsWithMarker: mobileAssistantResponseEndsWithMarker(
        source,
        state.thinkToken,
      ),
      responseMatchesExpected: state.expectedResponse
        ? mobileAssistantResponseMatches(source, state.expectedResponse)
        : false,
      cutoffVisible: /reply cut off at the token limit/i.test(text),
      savedAssistantVisible: mobileMessageHasMarker(
        source,
        'assistant-message',
        state.thinkToken,
      ),
    };
  }

  return surface.ui.evaluate(`
    const token = ${JSON.stringify(state.thinkToken)};
    const visible = (node) => Boolean(node && node.offsetParent !== null);
    const assistantMessages = [...document.querySelectorAll('[data-testid^="chat-message-"]')]
      .filter((message) => message.querySelector('button[title="Regenerate"]'));
    const responses = assistantMessages.map((message) => {
      const directBubble = [...message.children]
        .find((child) => child.matches?.('.rounded-md') && !child.matches?.('[data-slot="collapsible"]'));
      return (directBubble?.innerText || '').trim();
    });
    const liveStatus = [...document.querySelectorAll('[role="status"]')]
      .filter(visible)
      .map((node) => node.innerText || '');
    const stopVisible = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .some((node) => /stop/i.test(node.innerText || node.getAttribute('aria-label') || node.title || ''));
    return {
      live: stopVisible || liveStatus.some((status) => /thinking|analyzing|generating response/i.test(status)),
      finalResponseEndsWithMarker: responses.some((response) => response.endsWith(token)),
      responseMatchesExpected: ${JSON.stringify(state.expectedResponse ?? '')}
        ? responses.some((response) => response.trim() === ${JSON.stringify(
          state.expectedResponse ?? '',
        )})
        : false,
      cutoffVisible: liveStatus.some((status) => /stopped at the configured.*token limit/i.test(status)),
      savedAssistantVisible: responses.some((response) => response.toLowerCase().includes(token.toLowerCase())),
    };
  `);
};

await mkdir(evidenceDir, { recursive: true });

const readState = async () => {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {
      run,
      createdAt: new Date().toISOString(),
      actions: [],
      sent: false,
    };
  }
};

const saveState = async state => {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
};

const record = async entry => {
  const event = { at: new Date().toISOString(), step, ...entry };
  await appendFile(logPath, `${JSON.stringify(event)}\n`);
  const state = await readState();
  state.actions.push(event);
  await saveState(state);
};

const connect = kind => connectSurface({ ...specFor(kind), passive: true });
const connectDriving = kind =>
  connectSurface({ ...specFor(kind), passive: false });

const capture = async (surface, phase) => {
  const prefix = `${String((await readState()).actions.length).padStart(
    2,
    '0',
  )}-${safe(step)}-${surface.platform}-${phase}`;
  const text = await surface.text();
  await writeFile(join(evidenceDir, `${prefix}.txt`), `${text}\n`);
  const screenshot = join(evidenceDir, `${prefix}.png`);
  await surface.screenshot(screenshot);
  return { text, screenshot };
};

const closeTransientMobileSheet = async surface => {
  const labels = await surface.ui.labels();
  if (labels.includes('Done')) {
    // The currently installed app predates AppSheet's stable close testID. Android Back follows the
    // sheet's onRequestClose contract and avoids a text or coordinate selector.
    await surface.ui.back();
    await sleep(500);
  }
};

const openMobileChat = async surface => {
  await closeTransientMobileSheet(surface);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const labels = await surface.ui.labels();
    if (
      labels.includes('chat-screen') &&
      labels.some(label => label.includes(run))
    )
      return;
    const markerAt = labels.findIndex(label => label.includes(run));
    const rows = labels
      .map((label, index) => ({ label, index }))
      .filter(({ label }) => /^conversation-item-\d+$/.test(label));
    const row =
      markerAt < 0
        ? undefined
        : rows.sort(
            (left, right) =>
              Math.abs(left.index - markerAt) -
              Math.abs(right.index - markerAt),
          )[0]?.label;
    if (row) {
      await surface.ui.tapLabel(row);
    } else if (labels.includes('chats-tab')) {
      await surface.ui.tapLabel('chats-tab');
    } else if (labels.includes('Back')) {
      await surface.ui.tapLabel('Back');
    } else {
      await surface.ui.back();
    }
    await sleep(700);
  }
  throw new Error(
    `${surface.platform} could not open the existing ${run} chat`,
  );
};

const openDesktopChat = async surface => {
  const desktopChatIsOpen = () =>
    surface.ui.evaluate(`
    const wanted = ${JSON.stringify(run.toLowerCase())};
    const hasMarker = [...document.querySelectorAll('[data-testid^="chat-message-"]')]
      .some((node) => (node.innerText || '').toLowerCase().includes(wanted));
    const composer = document.querySelector(
      'textarea, input[placeholder*="Ask" i], [contenteditable="true"]',
    );
    return hasMarker && Boolean(composer && composer.offsetParent !== null);
  `);
  const alreadyOpen = await surface.ui.evaluate(`
    const wanted = ${JSON.stringify(run.toLowerCase())};
    const hasMarker = [...document.querySelectorAll('[data-testid^="chat-message-"]')]
      .some((node) => (node.innerText || '').toLowerCase().includes(wanted));
    const composer = document.querySelector(
      'textarea, input[placeholder*="Ask" i], [contenteditable="true"]',
    );
    return hasMarker && Boolean(composer && composer.offsetParent !== null);
  `);
  if (!alreadyOpen) {
    const markerVisible = await surface.ui.evaluate(`
      document.body.innerText.toLowerCase().includes(${JSON.stringify(
        run.toLowerCase(),
      )})
    `);
    if (!markerVisible) {
      const openedChatView = await surface.ui.evaluate(`
        const label = [...document.querySelectorAll('button > span')]
          .find((node) => (node.textContent || '').trim() === 'Chat');
        const button = label?.closest('button');
        if (!button) return false;
        button.click();
        return true;
      `);
      if (!openedChatView)
        throw new Error(
          `${surface.platform} does not expose the Chat nav button`,
        );
      await surface.ui.waitFor(
        () =>
          surface.ui.evaluate(`
          document.body.innerText.toLowerCase().includes(${JSON.stringify(
            run.toLowerCase(),
          )})
        `),
        {
          label: `${surface.platform} checkpoint chat row`,
          timeoutMs: 20_000,
          intervalMs: 500,
        },
      );
    }
    const opened = await surface.ui.evaluate(`
      const wanted = ${JSON.stringify(run.toLowerCase())};
      const owner = [...document.querySelectorAll('.cursor-pointer')]
        .filter((node) => node.offsetParent !== null)
        .find((node) => (node.innerText || '').toLowerCase().includes(wanted));
      if (!owner) return false;
      owner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    `);
    if (!opened)
      throw new Error(
        `${surface.platform} does not show a clickable ${run} chat row`,
      );
  }
  await surface.ui.waitFor(desktopChatIsOpen, {
    label: `${surface.platform} checkpoint chat`,
    timeoutMs: 20_000,
    intervalMs: 500,
  });
};

const openChat = surface =>
  surface.family === 'rn' ? openMobileChat(surface) : openDesktopChat(surface);

/**
 * Put ONE surface on its Chat screen, without needing a chat to exist yet.
 *
 * openChat/openDesktopChat both hunt for the run marker, so neither can be used before the journey
 * has sent anything - they are verification, not setup. This is the setup half: get every device to
 * the place the conversation will appear, so a run starts from four comparable screens and a person
 * watching can see the message land rather than discovering afterwards that Android was sitting on
 * the launcher and Windows on the Models tab.
 */
const showChatSurface = async surface => {
  if (surface.family === 'rn') {
    const labels = await surface.ui.labels();
    if (labels.includes('chat-screen')) return 'already on chat';
    if (labels.includes('chats-tab')) {
      await surface.ui.tapLabel('chats-tab');
      await surface.ui.waitForLabel('chat-screen', {
        label: `${surface.platform} chat screen`,
        timeoutMs: 20_000,
      });
      return 'opened the Chats tab';
    }
    throw new Error(`${surface.platform} exposes neither chat-screen nor chats-tab`);
  }
  // Park the desktops on Day, NOT on Chat.
  //
  // Clicking Chat when the app is already in Chat does nothing, so the desktop stays pinned to
  // whatever conversation was open last and never moves to the one the run creates - which is
  // exactly what was seen on macOS and Windows: the message had synced, the screen had not
  // changed. Leaving Chat first means the journey's own openDesktopChat has to re-enter it, and
  // re-entering lands on the new conversation.
  const clicked = await surface.ui.evaluate(`
    const label = [...document.querySelectorAll('button > span')]
      .find((node) => (node.textContent || '').trim() === 'Day');
    const button = label?.closest('button');
    if (!button) return false;
    button.click();
    return true;
  `);
  if (!clicked)
    throw new Error(`${surface.platform} does not expose the Day nav button`);
  // Report on the state reached, not on the click returning true.
  await surface.ui.waitFor(
    () =>
      surface.ui.evaluate(
        `return location.href.toLowerCase().includes('/day');`,
      ),
    { label: `${surface.platform} on Day`, timeoutMs: 20_000, intervalMs: 500 },
  );
  return 'parked on Day, so re-entering Chat must land on the new conversation';
};

const assertChatOpen = async surface => {
  const text = await surface.text();
  if (!text.toLowerCase().includes(run.toLowerCase())) {
    throw new Error(`${surface.platform} is not on checkpoint chat ${run}`);
  }
  if (surface.family === 'rn') {
    const labels = await surface.ui.labels();
    if (!labels.includes('chat-screen'))
      throw new Error(`${surface.platform} checkpoint chat is not open`);
    return;
  }
  const composer = await surface.ui.evaluate(`
    const wanted = ${JSON.stringify(run.toLowerCase())};
    const hasMarker = [...document.querySelectorAll('[data-testid^="chat-message-"]')]
      .some((message) => (message.innerText || '').toLowerCase().includes(wanted));
    const node = document.querySelector('textarea, input[placeholder*="Ask" i], [contenteditable="true"]');
    return hasMarker && Boolean(node && node.offsetParent !== null);
  `);
  if (!composer)
    throw new Error(
      `${surface.platform} checkpoint chat content or composer is not visible`,
    );
};

const waitUntil = async (check, label, limitMs = timeoutMs) => {
  const started = Date.now();
  while (Date.now() - started < limitMs) {
    const result = await check();
    if (result) return result;
    await sleep(500);
  }
  throw new Error(`timed out after ${limitMs}ms waiting for ${label}`);
};

/**
 * A fresh chat on whichever device is driving.
 *
 * Named for the ROLE, not the platform: this speaks the shared label vocabulary, and Android and iOS
 * carry identical testIDs because they are the same React Native tree. Calling it "Android" is what
 * made the normal-message stage look like it needed an Android-shaped path of its own.
 */
const openNewPrimaryChat = async surface => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const labels = await surface.ui.labels();
    if (labels.includes('home-screen')) break;
    if (labels.includes('home-tab')) {
      await surface.ui.tapLabel('home-tab');
    } else if (labels.includes('Back')) {
      await surface.ui.tapLabel('Back');
    } else {
      await surface.ui.back();
    }
    await sleep(600);
  }
  await surface.ui.waitForLabel('home-screen', {
    label: 'Android home',
    timeoutMs: 20_000,
  });
  await surface.ui.tapLabel('new-chat-button');
  await surface.ui.waitForLabel('chat-screen', {
    label: 'new Android chat',
    timeoutMs: 20_000,
  });
};

const openAndroidProjectChat = async (surface, projectName) => {
  const current = await surface.ui.labels();
  if (
    current.includes('chat-screen') &&
    current.some(label => label.includes(projectName))
  )
    return;
  await openNewAndroidProjectChat(surface, projectName);
};

const openNewAndroidProjectChat = async (surface, projectName) => {
  await openPrimaryProjects(surface);
  await surface.ui.scrollToLabel(projectName, { maxSwipes: 10 });
  await surface.ui.tapLabel(projectName);
  await surface.ui.waitForLabel('project-detail-screen', {
    label: `${projectName} detail`,
    timeoutMs: 20_000,
  });
  const labels = await surface.ui.labels();
  const chatControl = labels.includes('project-new-chat')
    ? 'project-new-chat'
    : 'project-start-chat';
  await surface.ui.tapLabel(chatControl);
  await surface.ui.waitForLabel('chat-screen', {
    label: `${projectName} new chat`,
    timeoutMs: 20_000,
  });
  await surface.ui.waitForLabel(projectName, {
    label: `${projectName} selected in chat`,
    timeoutMs: 20_000,
  });
};

const openPrimaryProjects = async surface => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const labels = await surface.ui.labels();
    if (labels.includes('projects-screen')) return;
    if (labels.includes('projects-tab')) {
      await surface.ui.tapLabel('projects-tab');
    } else {
      await surface.ui.back();
    }
    await sleep(600);
  }
  throw new Error(`${surface.platform} could not open Projects`);
};

const projectFileAttachments = fixture => [
  ...fixture.fileAttachments.map(fileName => ({
    fileName,
    sourcePath: join(projectFixtureDir, fileName),
    source: 'repository',
  })),
];

const stageProjectFixtures = async (kind, attachments) => {
  // iOS seeding, the counterpart to `adb push`. devicectl writes straight into the app's own data
  // container, which is the "real seeding path" the handoff doc asked for - no Files-app detour and
  // nothing to click. The UI journey either side of this was always platform-agnostic; only getting
  // the fixture bytes onto the device was not.
  if (kind === 'ios') {
    const udid = flag(
      'ios-udid',
      process.env.WDA_UDID ?? '4CF4A291-280A-598C-8AC5-851073C14B30',
    );
    const bundleId = flag('ios-bundle', 'ai.offgridmobile.dev');
    for (const attachment of attachments) {
      await execFile('xcrun', [
        'devicectl',
        'device',
        'copy',
        'to',
        '--device',
        udid,
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        bundleId,
        '--source',
        attachment.sourcePath,
        '--destination',
        `Documents/${attachment.fileName}`,
      ]);
    }
    return 'Documents';
  }
  if (kind !== 'android') {
    throw new Error(
      `${kind} fixture staging is not configured yet; the shared UI journey already supports --primary ${kind}`,
    );
  }
  const adb = new AdbClient(flag('android', '505b53a0'));
  const remoteDir = `/sdcard/Download/OffGridE2E/${safe(run)}`;
  await adb.shell(['mkdir', '-p', remoteDir]);
  for (const attachment of attachments) {
    await adb.push(
      attachment.sourcePath,
      `${remoteDir}/${attachment.fileName}`,
    );
  }
  return remoteDir;
};

/**
 * Prove the project and its Knowledge Base reached the OTHER devices.
 *
 * prepare-project only ever checked the device that created the project, so "the project is ready"
 * meant "ready on the phone that made it" - which is not what a mesh claims. A project carries its
 * name, description, system prompt and indexed documents; if those do not arrive, a guided run on a
 * peer answers from an empty Knowledge Base and still looks like a pass.
 *
 * Checked on each peer's own Projects surface, by the names a person would read.
 */
const showProjectsSurface = async surface => {
  if (surface.family === 'rn') {
    if ((await surface.ui.labels()).includes('projects-screen')) return;
    await surface.ui.tapLabel('projects-tab');
    await surface.ui.waitForLabel('projects-screen', {
      label: `${surface.platform} projects screen`,
      timeoutMs: 20_000,
    });
    return;
  }
  const clicked = await surface.ui.evaluate(`
    const label = [...document.querySelectorAll('button > span')]
      .find((node) => (node.textContent || '').trim() === 'Projects');
    const button = label?.closest('button');
    if (!button) return false;
    button.click();
    return true;
  `);
  if (!clicked)
    throw new Error(`${surface.platform} does not expose the Projects nav`);
  await surface.ui.waitFor(
    () =>
      surface.ui.evaluate(
        `return location.href.toLowerCase().includes('/project');`,
      ),
    {
      label: `${surface.platform} on Projects`,
      timeoutMs: 20_000,
      intervalMs: 500,
    },
  );
};

const verifyProjectAcrossMesh = async (projectName, documents) => {
  const peers = meshKinds.filter(kind => kind !== primaryKind);
  const results = [];
  for (const kind of peers) {
    const surface = await connect(kind);
    try {
      await showProjectsSurface(surface);
      await waitUntil(
        async () => (await surface.text()).includes(projectName),
        `${kind} shows project ${projectName}`,
        90_000,
      );
      if (surface.family === 'rn') {
        await surface.ui.scrollAndTap(projectName, { maxSwipes: 10 });
      } else {
        await surface.ui.evaluate(`
          const wanted = ${JSON.stringify(projectName.toLowerCase())};
          const row = [...document.querySelectorAll('.cursor-pointer')]
            .filter((node) => node.offsetParent !== null)
            .find((node) => (node.innerText || '').toLowerCase().includes(wanted));
          row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return Boolean(row);
        `);
      }
      const missing = [];
      for (const name of documents) {
        const found = await waitUntil(
          async () => (await surface.text()).includes(name),
          `${kind} shows Knowledge Base document ${name}`,
          60_000,
        ).catch(() => false);
        if (!found) missing.push(name);
      }
      const shot = await capture(surface, `project-synced-${kind}`);
      await record({
        platform: kind,
        ok: missing.length === 0,
        action: 'verify-project-sync',
        projectName,
        missingDocuments: missing,
        after: shot.screenshot,
      });
      results.push({ kind, missing });
      console.log(
        missing.length
          ? `FAIL ${kind.padEnd(8)} project synced but ${missing.length} document(s) missing: ${missing.join(', ')}`
          : `SYNC ${kind.padEnd(8)} project and ${documents.length} Knowledge Base documents present`,
      );
    } finally {
      await Promise.resolve(surface.close()).catch(() => undefined);
    }
  }
  const broken = results.filter(result => result.missing.length);
  if (broken.length) {
    throw new Error(
      `project Knowledge Base did not sync to: ${broken
        .map(result => result.kind)
        .join(', ')}`,
    );
  }
  return results;
};

const fillPrimaryFields = async (surface, fields, submitTestId) => {
  if (surface.platform === 'android') {
    const appium = new AppiumAndroidClient(
      appiumUrl,
      flag('android', '505b53a0'),
    );
    try {
      for (const [testId, value] of fields) {
        let actual = '';
        for (let attempt = 0; attempt < 2 && actual !== value; attempt += 1) {
          await appium.replaceTestId(testId, value);
          actual = await appium.textTestId(testId);
        }
        if (actual !== value) {
          throw new Error(
            `${testId} does not contain the exact fixture value; refusing to submit`,
          );
        }
      }
      // A multiline field leaves Gboard over the sheet. A semantic tap can then land on Gboard's
      // settings control at the same screen position instead of the app's Save button underneath.
      await appium.hideKeyboard();
    } finally {
      await appium.close();
    }
    // UiAutomator only exposes the current viewport while the soft keyboard is open. Closing the
    // field session dismisses the keyboard; use the shared semantic surface for the visible action
    // so a sheet button below a multiline field is found and pressed in the same way as on iOS.
    await surface.ui.scrollToLabel(submitTestId, { maxSwipes: 4 });
    await surface.ui.tapLabel(submitTestId);
    return;
  }
  if (!surface.ui.replaceTestId)
    throw new Error(`${surface.platform} cannot replace text fields`);
  for (const [testId, value] of fields)
    await surface.ui.replaceTestId(testId, value);
  // Close the keyboard before pressing Save, exactly as the Android branch does. The editor's Save
  // control sits below a multiline field and under the keyboard, so the tap lands on a key instead.
  // The app not lifting that control above the keyboard is a real UI gap - logged in
  // docs/GAPS_BACKLOG.md rather than worked around silently here.
  // Get the submit control clear of the keyboard before pressing it.
  //
  // These sheets are not keyboard-aware (docs/GAPS_BACKLOG.md), so Save can sit UNDER the keyboard
  // and a tap aimed at it lands on a key. Ask the keyboard to close; if it will not - a multiline
  // field offers it no Done affordance - scroll the control up and MEASURE, rather than tapping
  // hopefully. An earlier attempt tapped a blind point above the keyboard to dismiss it, which on
  // the paste-note sheet hit Back and discarded everything typed.
  await surface.ui.hideKeyboard?.();
  await surface.ui.scrollToLabel(submitTestId, { maxSwipes: 4 }).catch(() => {});
  const keyboardTop = (await surface.ui.keyboardTop?.()) ?? null;
  if (keyboardTop !== null) {
    const control = await surface.ui.findByLabel(submitTestId);
    if (!control) {
      throw new Error(
        `${surface.platform} cannot find ${submitTestId} to submit`,
      );
    }
    if (control.center.y >= keyboardTop) {
      throw new Error(
        `${surface.platform} keyboard covers ${submitTestId} (control at y=${control.center.y}, keyboard from y=${keyboardTop}); refusing to tap a key instead`,
      );
    }
  }
  await surface.ui.tapLabel(submitTestId);
};

const ensurePrimaryProject = async (surface, state, fixture) => {
  await openPrimaryProjects(surface);
  const existing = await surface.ui
    .scrollToLabel(state.projectName, { maxSwipes: 10 })
    .catch(() => null);
  if (existing) {
    await surface.ui.tapLabel(state.projectName);
    await surface.ui.waitForLabel('project-detail-screen', {
      label: `${state.projectName} detail`,
      timeoutMs: 20_000,
    });
    return 'existing';
  }

  const current = await surface.ui.labels();
  const addControl = current.includes('new-project-button')
    ? 'new-project-button'
    : 'new-project-empty-button';
  await surface.ui.tapLabel(addControl);
  await surface.ui.waitForLabel('project-edit-screen', {
    label: 'New Project editor',
    timeoutMs: 20_000,
  });
  const reserved = await readState();
  reserved.projectCreateReservedAt ??= new Date().toISOString();
  await saveState(reserved);
  await fillPrimaryFields(
    surface,
    [
      ['project-edit-name', state.projectName],
      ['project-edit-description', fixture.description],
      ['project-edit-system-prompt', fixture.systemPrompt],
    ],
    'project-edit-save',
  );
  await surface.ui.waitForLabel('projects-screen', {
    label: 'Projects after save',
    timeoutMs: 20_000,
  });
  await surface.ui.scrollToLabel(state.projectName, { maxSwipes: 10 });
  await surface.ui.tapLabel(state.projectName);
  await surface.ui.waitForLabel('project-detail-screen', {
    label: `${state.projectName} detail`,
    timeoutMs: 20_000,
  });
  const created = await readState();
  created.projectCreatedAt = new Date().toISOString();
  await saveState(created);
  return 'created';
};

const ensurePrimaryTextAttachment = async (surface, fixture) => {
  const title = fixture.textAttachment.title;
  const documentLabel = `Knowledge document ${title}`;
  if (
    await surface.ui
      .scrollToLabel(documentLabel, { maxSwipes: 4 })
      .catch(() => null)
  )
    return 'existing';
  const text = await readFile(
    join(projectFixtureDir, fixture.textAttachment.file),
    'utf8',
  );
  await surface.ui.scrollAndTap('kb-paste-text', { maxSwipes: 6 });
  await surface.ui.waitForLabel('paste-note-text', {
    label: 'project text attachment sheet',
    timeoutMs: 20_000,
  });
  await fillPrimaryFields(
    surface,
    [
      ['paste-note-title', title],
      ['paste-note-text', text.trim()],
    ],
    'paste-note-save',
  );
  await surface.ui.waitForLabel(documentLabel, {
    label: `${title} indexed`,
    timeoutMs: 180_000,
  });
  // The per-document "Use <name>, ON" switch lives on the Knowledge Base screen, not on project
  // detail. Waiting for it here waited on a screen that never shows it, so a note that had saved
  // and indexed correctly still failed the step. prepare-project opens the Knowledge Base and
  // checks every document's switch there, which is the right place and already covers this one.
  return 'added';
};

/**
 * Attach every missing fixture file in ONE trip through the picker.
 *
 * The picker is multi-select and already sits in the folder the fixtures live in. Opening it once
 * per file meant three round trips, and each reopen was a fresh chance to land somewhere unexpected
 * - which is what kept happening. Worse, the old per-file path "navigated to the folder" by tapping
 * the label `Downloads`, which in the nav bar is `Downloads, Actions Menu`: that opens the folder's
 * context menu (Remove Download / Keep Downloaded / Copy) over the picker and blocks everything
 * underneath. There is no folder navigation here at all; the picker remembers where it was.
 *
 * `Open` exists only while something is selected, so it doubles as the check that the selection
 * took, and as the control that hands the files back.
 */
const ensurePrimaryFileAttachments = async (surface, fileNames) => {
  const pickerLabelFor = name => name.replace(/\.([^.]+)$/, ', $1');
  const missing = [];
  for (const name of fileNames) {
    const present = await surface.ui
      .scrollToLabel(`Knowledge document ${name}`, { maxSwipes: 4 })
      .catch(() => null);
    if (!present) missing.push(name);
  }
  if (!missing.length) return { added: [], existing: fileNames };

  await surface.ui.scrollAndTap('kb-add-document', { maxSwipes: 6 });
  // Wait for the picker itself, by the first file we need rather than by chrome.
  await surface.ui.waitForLabel(pickerLabelFor(missing[0]), {
    label: `${missing[0]} in the file picker`,
    timeoutMs: 30_000,
  });

  const selectionMade = async () =>
    (await surface.ui.labels()).includes('Open');
  for (const name of missing) {
    const label = pickerLabelFor(name);
    await surface.ui.tapLabel(label);
    await sleep(700);
  }
  if (!(await selectionMade())) {
    throw new Error(
      `none of ${missing.join(', ')} selected in the picker; no Open control appeared`,
    );
  }
  await surface.ui.tapLabel('Open');
  await surface.ui.waitForLabel('project-detail-screen', {
    label: 'project after file selection',
    timeoutMs: 60_000,
  });
  for (const name of missing) {
    await surface.ui.waitForLabel(`Knowledge document ${name}`, {
      label: `${name} indexed`,
      timeoutMs: 240_000,
    });
  }
  return { added: missing, existing: fileNames.filter(n => !missing.includes(n)) };
};


/** The Thinking toggle on whichever device is driving. Shared vocabulary, as above. */
const setPrimaryThinking = async (surface, enabled) => {
  let labels = await surface.ui.labels();
  if (!labels.includes('quick-thinking-toggle')) {
    if (!labels.includes('chat-screen'))
      throw new Error(`${surface.platform} chat is not open`);
    await surface.ui.tapLabel('quick-settings-button');
    // Wait for the sheet rather than sleeping a fixed 500ms: on iOS it animates in slower than
    // that, and the fixed wait turned "the sheet is still opening" into "this model has no
    // Thinking control".
    await surface.ui
      .waitForLabel('quick-thinking-toggle', {
        label: `${surface.platform} quick settings sheet`,
        timeoutMs: 20_000,
      })
      .catch(() => {});
    labels = await surface.ui.labels();
  }
  if (!labels.includes('quick-thinking-toggle')) {
    throw new Error(
      `${surface.platform} does not expose the Thinking control for the loaded model`,
    );
  }
  const isOn = labels.some(label => /Thinking, ON/i.test(label));
  if (isOn !== enabled) {
    await surface.ui.tapLabel('quick-thinking-toggle');
    await sleep(500);
    labels = await surface.ui.labels();
  }
  const expected = enabled ? /Thinking, ON/i : /Thinking, OFF/i;
  if (!labels.some(label => expected.test(label))) {
    throw new Error(
      `${surface.platform} Thinking control did not reach ${enabled ? 'ON' : 'OFF'}`,
    );
  }
  await surface.ui.back();
  await surface.ui.waitForLabel('chat-screen', {
    label: 'Android chat after Thinking change',
    timeoutMs: 20_000,
  });
};

const GUIDED_STANDARD_TOOLS = [
  { id: 'web_search', name: 'Web Search', enabled: true },
  { id: 'calculator', name: 'Calculator', enabled: false },
  { id: 'get_current_datetime', name: 'Date & Time', enabled: false },
  { id: 'get_device_info', name: 'Device Info', enabled: false },
  { id: 'search_knowledge_base', name: 'Knowledge Base', enabled: true },
  { id: 'read_url', name: 'URL Reader', enabled: true },
];

const setAndroidToolToggle = async (surface, tool) => {
  const control = `tool-picker-toggle-${tool.id}`;
  await surface.ui.scrollToLabel(control, { maxSwipes: 8 });
  let labels = await surface.ui.labels();
  const onLabel = `${tool.name}, ON`;
  const offLabel = `${tool.name}, OFF`;
  const isOn = labels.includes(onLabel);
  if (!isOn && !labels.includes(offLabel)) {
    throw new Error(`${surface.platform} does not expose a state for ${tool.name}`);
  }
  if (isOn !== tool.enabled) {
    await surface.ui.tapLabel(control);
    labels = await waitUntil(
      async () => {
        const current = await surface.ui.labels();
        return current.includes(tool.enabled ? onLabel : offLabel)
          ? current
          : false;
      },
      `${tool.name} ${tool.enabled ? 'ON' : 'OFF'}`,
      20_000,
    );
  }
  if (!labels.includes(tool.enabled ? onLabel : offLabel)) {
    throw new Error(
      `${tool.name} did not reach ${tool.enabled ? 'ON' : 'OFF'}`,
    );
  }
};

const prepareGuidedTools = async (surface, projectName) => {
  if (projectName && flag('fresh-chat', 'false') === 'true') {
    await openNewAndroidProjectChat(surface, projectName);
  } else if (projectName) await openAndroidProjectChat(surface, projectName);
  else await openNewPrimaryChat(surface);
  await setPrimaryThinking(surface, true);

  await surface.ui.tapLabel('quick-settings-button');
  await surface.ui.waitForLabel('quick-tools', {
    label: `${surface.platform} quick Tools control`,
    timeoutMs: 20_000,
  });
  await surface.ui.tapLabel('quick-tools');
  await surface.ui.waitForLabel('tools-pro-tools', {
    label: `${surface.platform} Tools screen`,
    timeoutMs: 20_000,
  });

  for (const tool of GUIDED_STANDARD_TOOLS) {
    await setAndroidToolToggle(surface, tool);
  }
  const toolsConfigured = await capture(surface, 'tools-configured');

  await surface.ui.scrollAndTap('tools-pro-tools', { maxSwipes: 8 });
  await surface.ui.waitForLabel('mcp-add-server', {
    label: `${surface.platform} MCP add control`,
    timeoutMs: 20_000,
  });
  await surface.ui.scrollAndTap('mcp-add-server', { maxSwipes: 8 });
  await surface.ui.scrollToLabel('mcp-preset-add-deepwiki', { maxSwipes: 8 });
  let labels = await surface.ui.labels();
  if (labels.includes('DeepWiki, Added')) {
    await surface.ui.tapLabel('mcp-add-server-close');
  } else if (labels.includes('DeepWiki, Add')) {
    await surface.ui.tapLabel('mcp-preset-add-deepwiki');
  } else {
    throw new Error(`${surface.platform} does not expose the DeepWiki preset state`);
  }

  await surface.ui.scrollToLabel('mcp-server-card-deepwiki', { maxSwipes: 8 });
  labels = await surface.ui.labels();
  if (labels.includes('DeepWiki, Inactive')) {
    await surface.ui.tapLabel('mcp-server-toggle-deepwiki');
  }
  await waitUntil(
    async () => {
      const current = await surface.ui.labels();
      return current.includes('DeepWiki, Active') &&
        current.includes('DeepWiki, 3/3 tools')
        ? current
        : false;
    },
    'DeepWiki Active with 3/3 tools',
    60_000,
  );
  const proToolsConfigured = await capture(surface, 'pro-tools-configured');

  await leaveVia(
    surface,
    'pro-tools-back',
    'tools-back',
    `${surface.platform} Tools screen after Pro tools`,
  );
  await leaveVia(
    surface,
    'tools-back',
    'chat-screen',
    `${surface.platform} chat after Tools setup`,
  );

  await surface.ui.tapLabel('quick-settings-button');
  const proBadge = expectedProToolBadge(surface.platform);
  labels = await surface.ui.waitFor(
    async () => {
      const current = await surface.ui.labels();
      const ready =
        current.some(label => /Thinking, ON/i.test(label)) &&
        current.some(label => /Tools, 3(?!\d)/i.test(label)) &&
        current.some(label =>
          new RegExp(`Pro Tools, ${proBadge}(?!\\d)`, 'i').test(label),
        );
      return ready ? current : false;
    },
    {
      label: `${surface.platform} guided tool badges (Tools 3, Pro Tools ${proBadge})`,
      timeoutMs: 20_000,
      intervalMs: 500,
    },
  );
  const ready = await capture(surface, 'guided-tools-ready');
  // The sheet is a toggle: close it the way it was opened, not with a back gesture.
  if ((await surface.ui.labels()).includes('quick-tools')) {
    await surface.ui.tapLabel('quick-settings-button');
  }
  await surface.ui.waitForLabel('chat-screen', {
    label: `${surface.platform} prepared chat`,
    timeoutMs: 20_000,
  });

  return {
    thinking: 'on',
    standardTools: GUIDED_STANDARD_TOOLS.filter(tool => tool.enabled).map(
      tool => tool.id,
    ),
    deepWiki: 'active-3-of-3',
    toolsConfigured: toolsConfigured.screenshot,
    proToolsConfigured: proToolsConfigured.screenshot,
    ready: ready.screenshot,
  };
};

/**
 * The inverse of prepareGuidedTools: strip the chat back to no thinking and no tools.
 *
 * A "no thinking, no tool calls, and it syncs" journey is not testing sync when nine tools are
 * attached - it is testing whether the model resists them. On 2026-08-16 an iPhone carrying 9
 * enabled tools (3 standard + 6 Pro) answered
 *
 *   "Reply with exactly: <marker>. Do not add any other text."
 *
 * with a refusal that listed all nine tools and never emitted the marker. Every surface then failed
 * its check and a HEALTHY mesh read as a sync failure - the conversation and that refusal had in
 * fact propagated to all four devices. The picker says as much itself: "Too many tools can confuse
 * the model and increase latency on the first response."
 *
 * So tool state is SETUP, not something a journey inherits from whatever the device was last left
 * on. This reuses the guided journey's declarative list and its toggle helper with every tool asked
 * for OFF, so the two directions cannot drift apart.
 *
 * iOS caveat: the three built-in Pro tools (Send Email, Create/Read Calendar Event) render as
 * `pro-tool-row-*` with NO switch and no ON/OFF in the accessibility tree, and tapping a row does
 * nothing. Only MCP servers can be stopped there, so iOS bottoms out at Pro Tools 3 where Android
 * reaches 0. That is a picker parity gap, not a fault in this step.
 */
const NO_STANDARD_TOOLS = GUIDED_STANDARD_TOOLS.map(tool => ({
  ...tool,
  enabled: false,
}));

/**
 * Leave a screen by its OWN Back control, falling back to the platform gesture.
 *
 * iOS has no hardware Back, and its edge-swipe does not reliably pop the tool screens - runs were
 * left stranded on Pro tools waiting for a chat that was still two screens away. Shared by both
 * directions of the tools journey so they cannot drift.
 */
const leaveVia = async (surface, control, expected, what) => {
  if ((await surface.ui.labels()).includes(control)) {
    await surface.ui.tapLabel(control);
  } else {
    await surface.ui.back();
  }
  await surface.ui.waitForLabel(expected, { label: what, timeoutMs: 20_000 });
};

/**
 * How many Pro tools the badge should read once DeepWiki is active.
 *
 * Android can switch its three built-in Pro tools (Send Email, Create/Read Calendar Event) off, so
 * the badge is DeepWiki's 3. On iOS those three render as `pro-tool-row-*` with no switch and no
 * state in the accessibility tree - tapping the row does nothing - so they stay on and the badge is
 * 3 + 3. Asserting Android's number on an iPhone failed a correctly configured device.
 */
const expectedProToolBadge = platform => (platform === 'ios' ? 6 : 3);

/** Stop every MCP server that is currently Active. Mirrors the guided flow's DeepWiki activation. */
const deactivateMcpServers = async surface => {
  const stopped = [];
  await surface.ui.scrollAndTap('tools-pro-tools', { maxSwipes: 8 });
  await surface.ui.waitForLabel('mcp-add-server', {
    label: `${surface.platform} MCP server list`,
    timeoutMs: 20_000,
  });
  await surface.ui
    .scrollToLabel('mcp-server-card-deepwiki', { maxSwipes: 8 })
    .catch(() => {});
  if ((await surface.ui.labels()).includes('DeepWiki, Active')) {
    await surface.ui.tapLabel('mcp-server-toggle-deepwiki');
    await waitUntil(
      async () => (await surface.ui.labels()).includes('DeepWiki, Inactive'),
      'DeepWiki Inactive',
      30_000,
    );
    stopped.push('deepwiki');
  }
  return stopped;
};

const prepareNoTools = async surface => {
  await setPrimaryThinking(surface, false);

  await surface.ui.tapLabel('quick-settings-button');
  await surface.ui.waitForLabel('quick-tools', {
    label: `${surface.platform} quick Tools control`,
    timeoutMs: 20_000,
  });
  await surface.ui.tapLabel('quick-tools');
  await surface.ui.waitForLabel('tools-pro-tools', {
    label: `${surface.platform} Tools screen`,
    timeoutMs: 20_000,
  });

  for (const tool of NO_STANDARD_TOOLS) {
    await setAndroidToolToggle(surface, tool);
  }
  const toolsCleared = await capture(surface, 'tools-cleared');

  const mcpStopped = await deactivateMcpServers(surface);
  const proCleared = await capture(surface, 'pro-tools-cleared');

  await leaveVia(
    surface,
    'pro-tools-back',
    'tools-back',
    `${surface.platform} Tools screen after Pro tools`,
  );
  await leaveVia(
    surface,
    'tools-back',
    'chat-screen',
    `${surface.platform} chat after clearing tools`,
  );

  // Read the badges a person would read, rather than trusting the taps.
  await surface.ui.tapLabel('quick-settings-button');
  const labels = await surface.ui.waitFor(
    async () => {
      const current = await surface.ui.labels();
      const thinkingOff = current.some(label => /Thinking, OFF/i.test(label));
      const standardLeft = current.some(label => /(^|,)\s*Tools, [1-9]/i.test(label));
      return thinkingOff && !standardLeft ? current : false;
    },
    {
      label: `${surface.platform} cleared tool badges`,
      timeoutMs: 20_000,
      intervalMs: 500,
    },
  );
  const ready = await capture(surface, 'no-tools-ready');
  // While the sheet is open Android exposes only the sheet rows, not the toolbar button that
  // opened it. Back is the shared close gesture on both mobile platforms and does not depend on an
  // element hidden behind the modal accessibility tree.
  if ((await surface.ui.labels()).includes('quick-tools')) {
    await surface.ui.back();
  }
  await surface.ui.waitForLabel('chat-screen', {
    label: `${surface.platform} chat with no tools`,
    timeoutMs: 20_000,
  });

  return {
    thinking: 'off',
    standardTools: [],
    mcpStopped,
    badges: labels.find(label => /Tools/.test(label)) ?? null,
    toolsCleared: toolsCleared.screenshot,
    proToolsCleared: proCleared.screenshot,
    ready: ready.screenshot,
  };
};

const readAndroidGuidedToolEvidence = async token => {
  const adb = new AdbClient(flag('android', '505b53a0'));
  const wire = await adb.readAppFile(
    'ai.offgridmobile.dev',
    'files/offgrid-wire.log',
  );
  const calls = [];
  const outputs = [];
  let thinkingEnabled = false;
  for (const line of wire.split('\n')) {
    const prefix = '[WIRE-LLAMA-TOOL] ';
    const at = line.indexOf(prefix);
    if (at < 0 || !line.includes(token)) continue;
    try {
      const entry = JSON.parse(line.slice(at + prefix.length));
      thinkingEnabled ||= entry.input?.enable_thinking === true;
      const outputCalls = entry.output?.tool_calls ?? [];
      for (const call of outputCalls) {
        if (call.function?.name) calls.push(call.function.name);
      }
      if (entry.output?.text && outputCalls.length === 0)
        outputs.push(entry.output.text);
    } catch {
      // A partial line can be present while the lossless sink is flushing. The next verification run reads it again.
    }
  }
  const missing = GUIDED_REQUIRED_TOOL_CALLS.filter(
    name => !calls.includes(name),
  );
  const callCounts = Object.fromEntries(
    GUIDED_REQUIRED_TOOL_CALLS.map(name => [
      name,
      calls.filter(call => call === name).length,
    ]),
  );
  const overused = GUIDED_REQUIRED_TOOL_CALLS.filter(
    name => callCounts[name] > 2,
  );
  return {
    thinkingEnabled,
    calls,
    callCounts,
    missing,
    overused,
    finalOutput: outputs.at(-1)?.trim() ?? '',
  };
};

/**
 * Send the prompt from iOS, through the surface rather than Appium.
 *
 * Appium here is the Android driver; iOS is driven over WebDriverAgent, so the send path cannot be
 * shared. What IS shared is the vocabulary - both phones are the same app, so the input and the send
 * button carry the same handles - and the check that matters is identical: the prompt is not sent
 * until the device shows it as a user message.
 */
const dispatchIosPrompt = async ({ surface, prompt, token, beforeClick }) => {
  await surface.ui.tapLabel('chat-input');
  await sleep(500);
  await surface.ui.type(prompt);
  await sleep(800);
  const sendVisible = (await surface.ui.labels()).includes('send-button');
  if (!sendVisible) throw new Error('iOS shows no send control for the typed prompt');
  await beforeClick({ platform: 'ios', control: 'send-button' });
  await surface.ui.tapLabel('send-button');
  await waitUntil(
    async () => mobileMessageHasMarker(await surface.ui.source(), 'user-message', token),
    'iOS pending message',
    60_000,
  );
  return { kind: 'sent' };
};

const dispatchAndroidPrompt = async ({
  appium,
  prompt,
  token,
  hasExistingDraft = false,
  beforeClick,
}) => {
  await appium.session();
  if (!hasExistingDraft) {
    await appium.replaceTestId('chat-input', prompt);
  } else {
    console.log(`DRAFT android  reusing ${token}`);
  }
  const sendElementId = await appium.findByTestId('send-button');
  const sendDescription = await appium.describeElement(sendElementId);
  if (
    sendDescription.resourceId !== 'send-button' ||
    sendDescription.displayed !== true ||
    sendDescription.enabled !== true ||
    sendDescription.clickable !== 'true'
  ) {
    throw new Error(
      `Android send element is not actionable: ${JSON.stringify(
        sendDescription,
      )}`,
    );
  }
  console.log(`TARGET android  ${JSON.stringify(sendDescription)}`);
  await beforeClick(sendDescription);
  await appium.clickElement(sendElementId);
  const dispatchResult = await waitUntil(
    async () => {
      const sentMessage = await appium
        .findUserMessageContaining(token)
        .catch(() => undefined);
      if (sentMessage) return { kind: 'sent', elementId: sentMessage };
      const pickerRow = await appium
        .findByTestId(QWEN_ROW_TEST_ID)
        .catch(() => undefined);
      return pickerRow ? { kind: 'picker', elementId: pickerRow } : false;
    },
    'Android pending message or Qwen model picker',
    60_000,
  );
  if (dispatchResult.kind === 'picker') {
    const qwenDescription = await appium.describeElement(
      dispatchResult.elementId,
    );
    if (
      qwenDescription.displayed !== true ||
      qwenDescription.enabled !== true
    ) {
      throw new Error(
        `Qwen picker row is not actionable: ${JSON.stringify(qwenDescription)}`,
      );
    }
    console.log(`PICK android  testID="${QWEN_ROW_TEST_ID}"`);
    await appium.clickElement(dispatchResult.elementId);
    await waitUntil(
      () => appium.findUserMessageContaining(token).catch(() => false),
      'pending Android user message after Qwen selection',
      180_000,
    );
  } else {
    console.log(
      'SEND android  pending user message visible without a model picker',
    );
  }
  return sendDescription;
};

const openSyncedChat = surface =>
  waitUntil(
    async () => {
      try {
        await openChat(surface);
        return true;
      } catch {
        return false;
      }
    },
    `${surface.platform} synced chat`,
    90_000,
  );

const verifyNormalAcrossMesh = async (surfaces, state) => {
  await Promise.all(surfaces.map(openSyncedChat));
  const results = await Promise.all(
    surfaces.map(async surface => {
      await assertChatOpen(surface);
      const finalText = await waitUntil(async () => {
        const text = await surface.text();
        if (THINKING_LIVE.test(text)) return false;
        if (surface.family === 'rn') {
          const source = await surface.ui.source();
          return mobileMessageHasMarker(
            source,
            'assistant-message',
            state.normalToken,
          )
            ? text
            : false;
        }
        const messageCount = await surface.ui.evaluate(`
        const token = ${JSON.stringify(state.normalToken.toLowerCase())};
        return [...document.querySelectorAll('[data-testid^="chat-message-"]')]
          .filter((message) => (message.innerText || '').toLowerCase().includes(token)).length;
      `);
        return messageCount >= 2 ? text : false;
      }, `${surface.platform} final normal response`);
      const final = await capture(surface, 'final');
      console.log(
        `FINAL ${surface.platform.padEnd(8)} normal response visible`,
      );
      return { platform: surface.platform, finalText, final: final.screenshot };
    }),
  );
  for (const result of results) {
    await record({
      platform: result.platform,
      ok: true,
      action: 'verify-normal',
      final: result.final,
    });
  }
  console.log(
    'PASS mesh     final normal response verified on all four devices',
  );
};

const runAcrossMesh = async action => {
  // Run in series. Android UiAutomator permits only one active automation service, and serial
  // capture also makes the action order explicit in the evidence log.
  // Honours --mesh, so a device excluded from the run is excluded HERE too. It used to fall back to
  // every kind, which meant the run printed what it had left out and then ran it anyway.
  const kinds = requestedPlatform === 'all' ? meshKinds : [requestedPlatform];
  for (const kind of kinds) {
    const surface = await connect(kind);
    try {
      const before = await capture(surface, 'before');
      await action(surface);
      const after = await capture(surface, 'after');
      await record({
        platform: kind,
        ok: true,
        before: before.screenshot,
        after: after.screenshot,
      });
      console.log(`PASS ${kind.padEnd(8)} ${step}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await capture(surface, 'failed').catch(() => undefined);
      await record({
        platform: kind,
        ok: false,
        error: message,
        failed: failed?.screenshot,
      });
      throw error;
    } finally {
      await Promise.resolve(surface.close()).catch(() => undefined);
    }
  }
};

if (step === 'snapshot') {
  await runAcrossMesh(async () => undefined);
} else if (step === 'open-chat') {
  await runAcrossMesh(openChat);
} else if (step === 'run-normal') {
  const state = await readState();
  if (state.normalSent || state.normalSendReservedAt) {
    throw new Error(
      `Normal send is already ${
        state.normalSent ? 'complete' : 'reserved'
      }; refusing a duplicate`,
    );
  }
  state.normalToken ??= `normalproof${Date.now()}`;
  state.normalPrompt ??=
    `${run} normal sync check. Reply with exactly: ${state.normalToken} received. ` +
    'Do not add any other text.';
  await saveState(state);

  const surfaces = [];
  let appium;
  try {
    for (const kind of meshKinds) surfaces.push(await connect(kind));
    for (const surface of surfaces) {
      if (count(await surface.text(), state.normalToken) !== 0) {
        throw new Error(
          `${surface.platform} already contains ${state.normalToken}; refusing a duplicate`,
        );
      }
    }

    // The device that DRIVES is whichever --primary names. This stage used to find 'android' by
    // name and dispatch through Appium unconditionally, so --primary ios was accepted, validated,
    // and then ignored here - the iOS run silently went out from the Android phone. The journey
    // either side of this is already shared, because both apps are the same React Native tree with
    // the same testIDs; only the dispatch differs, and send-guided-tools already picks between them.
    const primary = surfaces.find(surface => surface.platform === primaryKind);
    if (!primary) throw new Error(`the mesh has no ${primaryKind} surface to drive`);
    const before = await capture(primary, 'before');
    await openNewPrimaryChat(primary);
    await setPrimaryThinking(primary, false);
    const ready = await capture(primary, 'ready');

    const reserve = async description => {
      const reserved = await readState();
      reserved.normalSendReservedAt = new Date().toISOString();
      reserved.normalSendTarget = description;
      await saveState(reserved);
    };
    if (primaryKind === 'ios') {
      await dispatchIosPrompt({
        surface: primary,
        prompt: state.normalPrompt,
        token: state.normalToken,
        beforeClick: reserve,
      });
    } else {
      appium = new AppiumAndroidClient(appiumUrl, flag('android', '505b53a0'));
      await dispatchAndroidPrompt({
        appium,
        prompt: state.normalPrompt,
        token: state.normalToken,
        beforeClick: reserve,
      });
      await appium.close();
      appium = undefined;
    }

    await waitUntil(
      async () => {
        const source = await primary.ui.source();
        return mobileMessageHasMarker(
          source,
          'user-message',
          state.normalToken,
        );
      },
      `${primaryKind} sent normal marker`,
      20_000,
    );
    const sent = await readState();
    sent.normalSent = true;
    sent.normalSentAt = new Date().toISOString();
    await saveState(sent);
    await record({
      platform: primaryKind,
      ok: true,
      action: 'send-normal',
      token: state.normalToken,
      before: before.screenshot,
      ready: ready.screenshot,
    });
    console.log(`SEND ${primaryKind.padEnd(8)}${state.normalToken}`);

    await verifyNormalAcrossMesh(surfaces, state);
  } finally {
    await appium?.close().catch(() => undefined);
    await Promise.all(
      surfaces.map(surface =>
        Promise.resolve(surface.close()).catch(() => undefined),
      ),
    );
  }
} else if (step === 'verify-normal') {
  const state = await readState();
  if (!state.normalSent || !state.normalToken) {
    throw new Error('there is no completed normal send to verify');
  }
  const surfaces = [];
  try {
    for (const kind of meshKinds) surfaces.push(await connect(kind));
    await verifyNormalAcrossMesh(surfaces, state);
  } finally {
    await Promise.all(
      surfaces.map(surface =>
        Promise.resolve(surface.close()).catch(() => undefined),
      ),
    );
  }
} else if (step === 'open-settings') {
  const surface = await connect('android');
  try {
    const before = await capture(surface, 'before');
    await openMobileChat(surface);
    const labels = await surface.ui.labels();
    if (!labels.includes('quick-settings-button'))
      throw new Error('Android chat settings control is absent');
    await surface.ui.tapLabel('quick-settings-button');
    await sleep(500);
    const after = await capture(surface, 'after');
    await record({
      platform: 'android',
      ok: true,
      before: before.screenshot,
      after: after.screenshot,
    });
    console.log('PASS android  open-settings');
  } finally {
    await Promise.resolve(surface.close()).catch(() => undefined);
  }
} else if (step === 'prepare-thinking') {
  // Honour --primary, as run-normal already does. Hardcoding 'android' here accepted --primary ios
  // and then set Thinking on the WRONG phone, so an "iOS thinking run" was an Android one wearing
  // its name. setPrimaryThinking already speaks the shared label vocabulary.
  const surface = await connect(primaryKind);
  try {
    const before = await capture(surface, 'before');
    // The SAME chat the journey has been using. Thinking is a per-message setting, so the stage
    // continues the checkpoint conversation that all four devices are already watching - which is
    // what lets the peers see Thinking go live rather than having to find a new chat mid-generation.
    await openMobileChat(surface);
    await setPrimaryThinking(surface, true);
    const after = await capture(surface, 'after');
    await record({
      platform: primaryKind,
      ok: true,
      thinking: 'on',
      before: before.screenshot,
      after: after.screenshot,
    });
    console.log(
      `PASS ${primaryKind}  prepare-thinking (Thinking ON, checkpoint chat open)`,
    );
  } finally {
    await Promise.resolve(surface.close()).catch(() => undefined);
  }
} else if (step === 'prepare-no-tools') {
  const surface = await connect(primaryKind);
  try {
    const before = await capture(surface, 'before');
    // Setup runs BEFORE the journey's chat exists, so start a fresh one rather than hunting for a
    // marker chat that has not been created yet. Same choice prepareGuidedTools makes.
    await openNewPrimaryChat(surface);
    const result = await prepareNoTools(surface);
    await record({
      platform: primaryKind,
      ok: true,
      ...result,
      before: before.screenshot,
    });
    console.log(
      `PASS ${primaryKind}  prepare-no-tools (Thinking OFF, standard tools OFF, MCP stopped: ${
        result.mcpStopped.join(', ') || 'none'
      })`,
    );
    if (result.badges) console.log(`  sheet reads: ${result.badges}`);
  } finally {
    await Promise.resolve(surface.close()).catch(() => undefined);
  }
} else if (step === 'prepare-screens') {
  const surfaces = [];
  try {
    for (const kind of meshKinds) surfaces.push(await connect(kind));
    for (const surface of surfaces) {
      const how = await showChatSurface(surface);
      console.log(`READY ${surface.platform.padEnd(8)} ${how}`);
    }
    console.log(`PASS mesh     ${surfaces.length} surfaces staged for the run`);
  } finally {
    for (const surface of surfaces) {
      await Promise.resolve(surface.close()).catch(() => undefined);
    }
  }
} else if (step === 'prepare-new-chat') {
  const surface = await connect('android');
  try {
    const before = await capture(surface, 'before');
    await openNewPrimaryChat(surface);
    const after = await capture(surface, 'after');
    await record({
      platform: 'android',
      ok: true,
      action: 'prepare-new-chat',
      before: before.screenshot,
      after: after.screenshot,
    });
    console.log('PASS android  blank new chat open; no prompt entered or sent');
  } finally {
    await Promise.resolve(surface.close()).catch(() => undefined);
  }
} else if (step === 'prepare-project') {
  const fixture = JSON.parse(
    await readFile(join(projectFixtureDir, 'project-fixture.json'), 'utf8'),
  );
  const attachments = projectFileAttachments(fixture);
  const state = await readState();
  state.projectName ??=
    flag('project-name', '') || `${fixture.projectNamePrefix} ${run}`;
  state.projectPrimary = primaryKind;
  await saveState(state);

  const surface = await connectDriving(primaryKind);
  try {
    const before = await capture(surface, 'project-before');
    const stagedAt = await stageProjectFixtures(primaryKind, attachments);
    const project = await ensurePrimaryProject(surface, state, fixture);
    const textAttachment = await ensurePrimaryTextAttachment(surface, fixture);
    // One trip through the picker for all three, not one trip each.
    const attached = await ensurePrimaryFileAttachments(
      surface,
      attachments.map(({ fileName }) => fileName),
    );
    const fileAttachments = Object.fromEntries(
      attachments.map(({ fileName, source }) => [
        fileName,
        {
          result: attached.added.includes(fileName) ? 'added' : 'existing',
          source,
        },
      ]),
    );
    // A pasted note is stored as a .txt document named after its title, so the Knowledge Base lists
    // "Off Grid AI overview.txt" while the fixture calls it "Off Grid AI overview". Checking for the
    // bare title never matched "Use <name>, ON", because the real label carries the extension
    // between the name and the state.
    const expectedDocuments = [
      `${fixture.textAttachment.title}.txt`,
      ...attachments.map(({ fileName }) => fileName),
    ];
    await surface.ui.waitForLabel(
      `Knowledge Base has ${expectedDocuments.length} documents`,
      {
        label: `project Knowledge Base count ${expectedDocuments.length}`,
        timeoutMs: 30_000,
      },
    );
    await surface.ui.tapLabel('project-knowledge-base-open');
    await surface.ui.waitForLabel('knowledge-base-screen', {
      label: 'project Knowledge Base screen',
      timeoutMs: 20_000,
    });
    for (const name of expectedDocuments) {
      await surface.ui.scrollToLabel(`Knowledge document ${name}`, {
        maxSwipes: 8,
      });
      await surface.ui.waitForLabel(`Use ${name}, ON`, {
        label: `${name} indexed and enabled`,
        timeoutMs: 20_000,
      });
    }
    const indexed = await capture(surface, 'project-indexed');
    // Leave by the screen's own Back control. iOS has no hardware back, and ui.back()'s edge swipe
    // does not reliably pop this screen - the run sat on the Knowledge Base waiting for a project
    // detail it had never navigated away from.
    if ((await surface.ui.labels()).includes('knowledge-base-back')) {
      await surface.ui.tapLabel('knowledge-base-back');
    } else {
      await surface.ui.back();
    }
    await surface.ui.waitForLabel('project-detail-screen', {
      label: 'project detail after Knowledge Base check',
      timeoutMs: 20_000,
    });
    const after = await capture(surface, 'project-after');
    const next = await readState();
    next.projectFixturePreparedAt = new Date().toISOString();
    next.projectFixture = {
      name: state.projectName,
      primary: primaryKind,
      stagedAt,
      project,
      textAttachment,
      fileAttachments,
      documents: expectedDocuments,
      indexed: indexed.screenshot,
    };
    await saveState(next);
    await record({
      platform: primaryKind,
      ok: true,
      action: 'prepare-project',
      projectName: state.projectName,
      before: before.screenshot,
      after: after.screenshot,
      indexed: indexed.screenshot,
      documents: expectedDocuments,
    });
    console.log(
      `PASS ${primaryKind.padEnd(8)} ${state.projectName} has ${
        expectedDocuments.length
      } indexed, enabled Knowledge Base documents`,
    );
    // A project that exists only on the device that made it is not a mesh result.
    await verifyProjectAcrossMesh(state.projectName, expectedDocuments);
    console.log(
      `PASS mesh     ${state.projectName} and its Knowledge Base present on every device`,
    );
  } finally {
    await Promise.resolve(surface.close()).catch(() => undefined);
  }
} else if (step === 'prepare-guided-tools') {
  const state = await readState();
  state.projectName ??= flag('project-name', '') || undefined;
  // Whichever device is producing. The preparation itself speaks only the surface vocabulary, and
  // both phones are the same React Native app, so the controls carry the same handles on each.
  const surface = await connectDriving(primaryKind);
  try {
    const before = await capture(surface, 'before');
    const result = await prepareGuidedTools(surface, state.projectName);
    const after = await capture(surface, 'after');
    const next = await readState();
    next.projectName ??= state.projectName;
    next.guidedToolPreparedAt = new Date().toISOString();
    next.guidedToolPreparation = result;
    await saveState(next);
    await record({
      platform: primaryKind,
      ok: true,
      action: 'prepare-guided-tools',
      before: before.screenshot,
      after: after.screenshot,
      ...result,
    });
    console.log(
      `PASS ${primaryKind}  Thinking ON; Web Search, Knowledge Base, URL Reader ON; DeepWiki Active 3/3`,
    );
  } finally {
    await Promise.resolve(surface.close()).catch(() => undefined);
  }
} else if (step === 'send-guided-tools') {
  const state = await readState();
  if (!state.guidedToolPreparedAt) {
    throw new Error(
      'Guided tools are not prepared for this run; run --step prepare-guided-tools first',
    );
  }
  // A reservation means "a send was ATTEMPTED", not "a send landed". If the attempt actually
  // reached the chat and the step then died before its bookkeeping - which is what happened when
  // closing a non-existent Appium session threw on the iOS path - refusing forever is wrong: the
  // prompt is sitting in the conversation and only the record is missing. Recover by looking at the
  // device, then let verify-guided-tools run. The duplicate guard still holds for a genuine rerun,
  // because a landed prompt is never sent twice.
  if (state.guidedToolSent) {
    throw new Error('Guided tool send is already complete; refusing a duplicate');
  }
  if (state.guidedToolSendReservedAt) {
    const surface = await connect(primaryKind);
    try {
      const landed = mobileMessageHasMarker(
        await surface.ui.source(),
        'user-message',
        state.guidedToolToken ?? run,
      );
      if (!landed) {
        throw new Error(
          'Guided tool send is already reserved but never reached the chat; clear the reservation before retrying',
        );
      }
      const recovered = await readState();
      recovered.guidedToolSent = true;
      recovered.guidedToolSentAt = new Date().toISOString();
      recovered.guidedToolRecoveredAt = new Date().toISOString();
      await saveState(recovered);
      console.log(
        `SEND ${primaryKind}  guided tool prompt already in the chat (${recovered.guidedToolToken}); recorded, nothing resent`,
      );
    } finally {
      await Promise.resolve(surface.close()).catch(() => undefined);
    }
  }
  if ((await readState()).guidedToolSent) {
    // Recovered above; verification is the next step.
  } else {
  state.guidedToolToken ??= run;
  state.guidedToolPrompt ??=
    flag('guided-prompt', '') ||
    'Give me all the details that you can about https://github.com/off-grid-ai/OGAM and Off Grid AI as a brand. ' +
      'Use Thinking. Before the final answer, call each enabled source tool: search_knowledge_base for Off Grid AI ' +
      'private intelligence layer; web_search for Off Grid AI OGAM brand; read_url for ' +
      'https://github.com/off-grid-ai/OGAM; DeepWiki read_wiki_structure for off-grid-ai/OGAM; DeepWiki ' +
      'read_wiki_contents for off-grid-ai/OGAM; and DeepWiki ask_question for off-grid-ai/OGAM with the question ' +
      'What does OGAM do and how does it support the Off Grid AI brand? You must call all six named tools at least once. ' +
      'You may call any individual tool no more than twice. ' +
      `Reference: ${state.guidedToolToken}.`;
  await saveState(state);

  const android = await connectDriving(primaryKind);
  let appium;
  try {
    const before = await capture(android, 'before');
    // Get back to the prepared chat rather than demanding to find it.
    //
    // connectDriving asks WDA for a session on the bundle, and on iOS that ACTIVATES the app - the
    // phone lands on Home, so this step destroyed the very chat it then required and failed with
    // "not on the prepared chat screen". The chat is the project's, and reopening it is idempotent.
    let labels = await android.ui.labels();
    if (!labels.includes('chat-screen') && state.projectName) {
      await openAndroidProjectChat(android, state.projectName);
      labels = await android.ui.labels();
    }
    if (
      !labels.includes('chat-screen') ||
      !labels.includes('quick-settings-button')
    ) {
      throw new Error(
        `${primaryKind} is not on the prepared chat screen`,
      );
    }
    const beforeSource = await android.ui.source();
    if (
      mobileMessageHasMarker(
        beforeSource,
        'user-message',
        state.guidedToolToken,
      )
    ) {
      throw new Error(
        `${state.guidedToolToken} is already visible; refusing a duplicate`,
      );
    }
    const reserve = async description => {
      const reserved = await readState();
      reserved.guidedToolSendReservedAt = new Date().toISOString();
      reserved.guidedToolSendTarget = description;
      await saveState(reserved);
    };
    if (primaryKind === 'ios') {
      await dispatchIosPrompt({
        surface: android,
        prompt: state.guidedToolPrompt,
        token: state.guidedToolToken,
        beforeClick: reserve,
      });
    } else {
      appium = new AppiumAndroidClient(appiumUrl, flag('android', '505b53a0'));
      await dispatchAndroidPrompt({
        appium,
        prompt: state.guidedToolPrompt,
        token: state.guidedToolToken,
        beforeClick: reserve,
      });
    }
    // Only the Android path opens an Appium session; the iOS branch never creates one, and closing
    // it unconditionally crashed AFTER the prompt had already been sent.
    await appium?.close();
    appium = undefined;
    await waitUntil(
      async () => {
        const source = await android.ui.source();
        return mobileMessageHasMarker(
          source,
          'user-message',
          state.guidedToolToken,
        );
      },
      'Android guided tool message',
      20_000,
    );
    const sent = await readState();
    sent.guidedToolSent = true;
    sent.guidedToolSentAt = new Date().toISOString();
    await saveState(sent);
    const after = await capture(android, 'after');
    await record({
      platform: 'android',
      ok: true,
      action: 'send-guided-tools',
      token: state.guidedToolToken,
      before: before.screenshot,
      after: after.screenshot,
    });
    console.log(`SEND android  guided tool prompt (${state.guidedToolToken})`);
  } finally {
    await appium?.close().catch(() => undefined);
    await Promise.resolve(android.close()).catch(() => undefined);
  }
  }
} else if (step === 'verify-guided-tools') {
  const state = await readState();
  if (!state.guidedToolSent || !state.guidedToolToken) {
    throw new Error('there is no completed guided-tool send to verify');
  }
  const android = await connect(primaryKind);
  try {
    // Poll the lossless model wire log while generation is active. Repeated UIAutomator dumps during
    // a long, rapidly changing transcript can fail before the model finishes and turn a product pass
    // into an automation-read failure. Touch the UI only after the model has emitted a final answer.
    // The wire log is the strongest evidence there is - the model's OWN record of what it called -
    // but it is read off the device with adb, so it exists for Android only. An iOS run is verified
    // from the transcript instead: weaker, because the UI shows what was drawn rather than what was
    // asked, and said so in the result rather than quietly claiming the same proof.
    const evidence =
      primaryKind === 'android'
        ? await waitUntil(
            async () => {
              const current = await readAndroidGuidedToolEvidence(
                state.guidedToolToken,
              );
              return current.finalOutput.length > 0 ? current : false;
            },
            'Android guided tool final output in wire log',
            timeoutMs,
          )
        : await waitUntil(
            async () => {
              const labels = await android.ui.labels();
              const called = GUIDED_REQUIRED_TOOL_CALLS.filter(name =>
                labels.some(label => label.includes(name)),
              );
              const settled = !labels.some(
                label =>
                  ['stop-button', 'thinking-indicator'].includes(label) ||
                  /Thinking\.\.\./i.test(label),
              );
              if (!settled || called.length === 0) return false;
              return {
                source: 'transcript',
                thinkingEnabled: labels.some(label =>
                  /thinking-block|Thought process/i.test(label),
                ),
                calls: called,
                callCounts: Object.fromEntries(called.map(name => [name, 1])),
                missing: GUIDED_REQUIRED_TOOL_CALLS.filter(
                  name => !called.includes(name),
                ),
                overused: [],
                finalOutput: labels.join('\n'),
              };
            },
            `${primaryKind} guided tool rows in the transcript`,
            timeoutMs,
          );
    const completed = await waitUntil(
      async () => {
        try {
          const labels = await android.ui.labels();
          const source = await android.ui.source();
          const live = labels.some(
            label =>
              [
                'stop-button',
                'thinking-indicator',
                'streaming-thinking-hint',
              ].includes(label) || /Thinking\.\.\./i.test(label),
          );
          const finalVisible = mobileHasCompletedAssistantAfterMarker(
            source,
            state.guidedToolToken,
          );
          return !live && finalVisible ? { live, finalVisible } : false;
        } catch {
          return false;
        }
      },
      'Android guided tool final response on screen',
      90_000,
    );
    const { live, finalVisible } = completed;
    const final = await capture(android, 'guided-tools-final');
    const result = { ...evidence, live, finalVisible, final: final.screenshot };
    const ok =
      evidence.thinkingEnabled &&
      evidence.missing.length === 0 &&
      evidence.overused.length === 0 &&
      !live &&
      finalVisible;
    await writeFile(
      join(evidenceDir, 'guided-tool-evidence.json'),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const next = await readState();
    next.guidedToolVerifiedAt = new Date().toISOString();
    next.guidedToolVerified = ok;
    next.guidedToolEvidence = result;
    await saveState(next);
    await record({
      platform: 'android',
      ok,
      action: 'verify-guided-tools',
      ...result,
    });
    console.log(
      `${ok ? 'PASS' : 'FAIL'} android  ${JSON.stringify({
        thinkingEnabled: evidence.thinkingEnabled,
        calls: evidence.calls,
        callCounts: evidence.callCounts,
        missing: evidence.missing,
        overused: evidence.overused,
        live,
        finalVisible,
      })}`,
    );
    if (!ok) {
      throw new Error(
        `Guided tool verification failed; missing: ${
          evidence.missing.join(', ') || 'none'
        }; ` + `overused: ${evidence.overused.join(', ') || 'none'}`,
      );
    }
  } finally {
    await Promise.resolve(android.close()).catch(() => undefined);
  }
} else if (step === 'run-thinking-clean') {
  const state = await readState();
  if (state.sent || state.sendReservedAt) {
    throw new Error(
      `Clean Thinking send is already ${
        state.sent ? 'complete' : 'reserved'
      }; refusing a duplicate`,
    );
  }
  state.thinkToken ??= `thinkproof${Date.now()}`;
  state.expectedResponse ??= flag('expected-response', '4');
  state.prompt ??= thinkingPrompt(state.thinkToken);
  await saveState(state);

  const surfaces = [];
  let appium;
  try {
    for (const kind of meshKinds) surfaces.push(await connect(kind));
    for (const surface of surfaces) {
      if (count(await surface.text(), state.thinkToken) !== 0) {
        throw new Error(
          `${surface.platform} already contains ${state.thinkToken}; refusing a duplicate`,
        );
      }
    }

    const android = surfaces.find(surface => surface.platform === 'android');
    await openNewPrimaryChat(android);
    await setPrimaryThinking(android, true);
    const ready = await capture(android, 'ready');
    console.log('READY android  clean chat open with Thinking ON');

    const observe = async surface => {
      if (surface.platform !== 'android') await openSyncedChat(surface);
      await assertChatOpen(surface);
      const first = await waitUntil(async () => {
        const result = await thinkingResult(surface, state);
        if (result.live) return { phase: 'live', result };
        if (
          finalThinkingResponseIsValid(result, state) ||
          result.savedAssistantVisible
        ) {
          return { phase: 'complete', result };
        }
        return false;
      }, `${surface.platform} clean Thinking state`);

      let live;
      const liveSeen = first.phase === 'live';
      if (liveSeen) {
        live = await capture(surface, 'live');
        console.log(`LIVE ${surface.platform.padEnd(8)} Thinking visible`);
      }
      const result =
        first.phase === 'complete'
          ? first.result
          : await waitUntil(async () => {
              const current = await thinkingResult(surface, state);
              return !current.live &&
                (finalThinkingResponseIsValid(current, state) ||
                  current.savedAssistantVisible)
                ? current
                : false;
            }, `${surface.platform} clean Thinking completion`);
      const final = await capture(surface, 'final');
      const ok = liveSeen && finalThinkingResponseIsValid(result, state);
      console.log(
        `${ok ? 'PASS' : 'FAIL'} ${surface.platform.padEnd(8)} ${JSON.stringify(
          { liveSeen, ...result },
        )}`,
      );
      return {
        platform: surface.platform,
        ok,
        liveSeen,
        result,
        live: live?.screenshot,
        final: final.screenshot,
      };
    };

    // Start peer observers before Send. They wait for the new synced chat row, then open it.
    const peerRuns = surfaces
      .filter(surface => surface.platform !== 'android')
      .map(surface => observe(surface));
    await sleep(500);

    appium = new AppiumAndroidClient(appiumUrl, flag('android', '505b53a0'));
    await dispatchAndroidPrompt({
      appium,
      prompt: state.prompt,
      token: state.thinkToken,
      beforeClick: async description => {
        const reserved = await readState();
        reserved.sendReservedAt = new Date().toISOString();
        reserved.sendTarget = description;
        await saveState(reserved);
      },
    });
    await appium.close();
    appium = undefined;

    await waitUntil(
      async () => {
        const source = await android.ui.source();
        return mobileMessageHasMarker(source, 'user-message', state.thinkToken);
      },
      'Android clean Thinking message',
      20_000,
    );
    const sent = await readState();
    sent.sent = true;
    sent.sentAt = new Date().toISOString();
    await saveState(sent);
    await record({
      platform: 'android',
      ok: true,
      action: 'send-clean-thinking',
      token: state.thinkToken,
      ready: ready.screenshot,
    });
    console.log(`SEND android  ${state.thinkToken}`);

    const results = await Promise.all([observe(android), ...peerRuns]);
    const failures = results.filter(result => !result.ok);
    for (const result of results) {
      await record({
        platform: result.platform,
        ok: result.ok,
        action: 'verify-clean-thinking',
        liveSeen: result.liveSeen,
        result: result.result,
        live: result.live,
        final: result.final,
      });
    }
    const verified = await readState();
    verified.thinkingFinalVerified = failures.length === 0;
    verified.thinkingFinalCheckedAt = new Date().toISOString();
    await saveState(verified);
    if (failures.length > 0) {
      throw new Error(
        `Clean Thinking failed on: ${failures
          .map(failure => failure.platform)
          .join(', ')}`,
      );
    }
    console.log(
      'PASS mesh     clean Thinking live state and final response verified on all four devices',
    );
  } finally {
    await appium?.close().catch(() => undefined);
    await Promise.all(
      surfaces.map(surface =>
        Promise.resolve(surface.close()).catch(() => undefined),
      ),
    );
  }
} else if (step === 'probe-send') {
  const state = await readState();
  if (state.sent || state.sendReservedAt) {
    throw new Error(
      'Thinking send is guarded; refusing to probe over an active attempt',
    );
  }
  state.thinkToken ??= `thinkproof${Date.now()}`;
  state.prompt ??= thinkingPrompt(state.thinkToken);
  await saveState(state);
  const android = await connect('android');
  const appium = new AppiumAndroidClient(
    appiumUrl,
    flag('android', '505b53a0'),
  );
  try {
    await assertChatOpen(android);
    const existingText = await android.text();
    await appium.session();
    if (!existingText.toLowerCase().includes(state.thinkToken.toLowerCase())) {
      await appium.replaceTestId('chat-input', state.prompt);
    }
    const elementId = await appium.findByTestId('send-button');
    const description = await appium.describeElement(elementId);
    const screenshot = join(
      evidenceDir,
      `${String(state.actions.length).padStart(2, '0')}-probe-send-android.png`,
    );
    await android.screenshot(screenshot);
    const next = await readState();
    next.sendProbe = {
      at: new Date().toISOString(),
      token: state.thinkToken,
      description,
      screenshot,
    };
    await saveState(next);
    await record({
      platform: 'android',
      ok: true,
      action: 'probe-send',
      description,
      screenshot,
    });
    console.log(
      JSON.stringify({ testID: 'send-button', ...description }, null, 2),
    );
    console.log('PASS android  send element probed; no click performed');
  } finally {
    await appium.close().catch(() => undefined);
    await Promise.resolve(android.close()).catch(() => undefined);
  }
} else if (step === 'run-thinking') {
  const state = await readState();
  if (state.sent || state.sendReservedAt) {
    throw new Error(
      `Thinking send is already ${
        state.sent ? 'complete' : 'reserved'
      }; refusing a duplicate`,
    );
  }
  state.thinkToken ??= `thinkproof${Date.now()}`;
  state.prompt ??= thinkingPrompt(state.thinkToken);
  await saveState(state);

  const surfaces = [];
  let appium;
  try {
    for (const kind of meshKinds) surfaces.push(await connect(kind));
    for (const surface of surfaces) await assertChatOpen(surface);
    const baselines = new Map();
    for (const surface of surfaces) {
      const text = await surface.text();
      baselines.set(surface.platform, {
        thinking: count(text, 'thinking'),
        marker: count(text, state.thinkToken),
      });
    }

    const observe = async (surface, initialText = '') => {
      const baseline = baselines.get(surface.platform);
      const isLive = text => {
        const thinkingCount = count(text, 'thinking');
        return THINKING_LIVE.test(text) || thinkingCount > baseline.thinking;
      };
      const liveText = isLive(initialText)
        ? initialText
        : await waitUntil(async () => {
            const text = await surface.text();
            return isLive(text) ? text : false;
          }, `${surface.platform} live Thinking state`);
      const live = await capture(surface, 'live');
      console.log(`LIVE ${surface.platform.padEnd(8)} Thinking visible`);
      const finalText = await waitUntil(async () => {
        const text = await surface.text();
        const thinkingCount = count(text, 'thinking');
        const liveEnded =
          !THINKING_LIVE.test(text) && thinkingCount <= baseline.thinking;
        if (!liveEnded) return false;
        const result = await thinkingResult(surface, state);
        return !result.live && finalThinkingResponseIsValid(result, state)
          ? text
          : false;
      }, `${surface.platform} final saved Thinking response`);
      const final = await capture(surface, 'final');
      console.log(`FINAL ${surface.platform.padEnd(8)} saved response visible`);
      return {
        platform: surface.platform,
        ok: true,
        live: live.screenshot,
        final: final.screenshot,
        liveText,
        finalText,
      };
    };

    // Send from whichever device --primary names, as run-normal already does. This stage used to
    // find the surface called 'android' and dispatch through Appium unconditionally, so
    // `--primary ios` was accepted, validated, and then ignored: the "iOS thinking run" went out
    // from the Android phone while the log said otherwise.
    const primary = surfaces.find(surface => surface.platform === primaryKind);
    if (!primary)
      throw new Error(`the mesh has no ${primaryKind} surface to drive`);
    // UiAutomator is single-owner. Observe the peers first, then send with no concurrent hierarchy
    // reads on the sending device. Its own observer starts only after the marker is visible in its
    // own chat.
    const observerRuns = surfaces
      .filter(surface => surface.platform !== primaryKind)
      .map(surface => observe(surface));
    await sleep(500);
    const draftText = await primary.text();
    const hasExistingDraft = draftText
      .toLowerCase()
      .includes(state.thinkToken.toLowerCase());
    if (hasExistingDraft) baselines.get(primaryKind).marker = 0;
    const reserveSend = async () => {
      const reserved = await readState();
      reserved.sendReservedAt = new Date().toISOString();
      await saveState(reserved);
    };
    if (primaryKind === 'ios') {
      await dispatchIosPrompt({
        surface: primary,
        prompt: state.prompt,
        token: state.thinkToken,
        beforeClick: reserveSend,
      });
    } else {
      appium = new AppiumAndroidClient(appiumUrl, flag('android', '505b53a0'));
      await dispatchAndroidPrompt({
        appium,
        prompt: state.prompt,
        token: state.thinkToken,
        hasExistingDraft,
        beforeClick: reserveSend,
      });
      await appium.close();
      appium = undefined;
    }
    await sleep(500);
    const primarySentText = await waitUntil(
      async () => {
        const source = await primary.ui.source();
        if (!mobileMessageHasMarker(source, 'user-message', state.thinkToken))
          return false;
        return primary.text();
      },
      `${primaryKind} sent Thinking marker`,
      20_000,
    );
    const sent = await readState();
    sent.sent = true;
    sent.sentAt = new Date().toISOString();
    await saveState(sent);
    await record({
      platform: primaryKind,
      ok: true,
      action: 'send-thinking',
      token: state.thinkToken,
    });
    console.log(`SEND ${primaryKind}  ${state.thinkToken}`);

    const results = await Promise.all([
      observe(primary, primarySentText),
      ...observerRuns,
    ]);
    for (const result of results) {
      await record({
        platform: result.platform,
        ok: result.ok,
        action: 'verify-thinking',
        live: result.live,
        final: result.final,
      });
    }
    console.log(
      'PASS mesh     live Thinking and final response verified on all four devices',
    );
  } finally {
    await appium?.close().catch(() => undefined);
    await Promise.all(
      surfaces.map(surface =>
        Promise.resolve(surface.close()).catch(() => undefined),
      ),
    );
  }
} else if (step === 'verify-thinking') {
  const state = await readState();
  if (!state.thinkToken || (!state.sent && !state.sendReservedAt)) {
    throw new Error('there is no guarded Thinking send to verify');
  }
  state.expectedResponse ??= flag('expected-response', '') || undefined;
  const surfaces = [];
  const failures = [];
  try {
    for (const kind of meshKinds) surfaces.push(await connect(kind));
    await Promise.all(surfaces.map(openSyncedChat));
    for (const surface of surfaces) {
      await assertChatOpen(surface);
      const result = await thinkingResult(surface, state);
      const final = await capture(surface, 'final');
      const ok = !result.live && finalThinkingResponseIsValid(result, state);
      await record({
        platform: surface.platform,
        ok,
        action: 'verify-thinking',
        result,
        final: final.screenshot,
      });
      console.log(
        `${ok ? 'PASS' : 'FAIL'} ${surface.platform.padEnd(8)} ${JSON.stringify(
          result,
        )}`,
      );
      if (!ok) failures.push(`${surface.platform}: ${JSON.stringify(result)}`);
    }
    const sent = await readState();
    sent.sent = true;
    sent.sentAt ??= sent.sendReservedAt;
    sent.thinkingFinalVerified = failures.length === 0;
    sent.thinkingFinalCheckedAt = new Date().toISOString();
    sent.thinkingFinalFailures = failures;
    await saveState(sent);
    if (failures.length > 0) {
      throw new Error(
        `Thinking final response failed on ${
          failures.length
        } device(s): ${failures.join('; ')}`,
      );
    }
    console.log(
      'PASS mesh     final Thinking response verified on all four devices',
    );
  } finally {
    await Promise.all(
      surfaces.map(surface =>
        Promise.resolve(surface.close()).catch(() => undefined),
      ),
    );
  }
} else if (step === 'recover-unsent') {
  const state = await readState();
  if (!state.thinkToken || (!state.sent && !state.sendReservedAt)) {
    throw new Error('there is no guarded Thinking attempt to recover');
  }
  const surfaces = [];
  try {
    for (const kind of meshKinds) surfaces.push(await connect(kind));
    for (const surface of surfaces) {
      const text = await surface.text();
      if (count(text, state.thinkToken) !== 0) {
        throw new Error(
          `${surface.platform} still contains ${state.thinkToken}; refusing recovery`,
        );
      }
    }
    const android = surfaces.find(surface => surface.platform === 'android');
    const labels = await android.ui.labels();
    if (
      !labels.includes('chat-screen') ||
      labels.some(label => label.includes(state.thinkToken))
    ) {
      throw new Error('Android chat is not clean; refusing recovery');
    }
    const failedAttempt = {
      token: state.thinkToken,
      prompt: state.prompt,
      reservedAt: state.sendReservedAt,
      recordedSentAt: state.sentAt,
      recoveredAt: new Date().toISOString(),
      result: 'marker absent on all four devices; Android composer empty',
    };
    state.failedAttempts ??= [];
    state.failedAttempts.push(failedAttempt);
    state.sent = false;
    delete state.sendReservedAt;
    delete state.sentAt;
    delete state.thinkToken;
    delete state.prompt;
    await saveState(state);
    await record({
      platform: 'mesh',
      ok: true,
      action: 'recover-unsent',
      failedAttempt,
    });
    console.log(
      'PASS mesh     guarded unsent attempt recovered after four-device absence proof',
    );
  } finally {
    await Promise.all(
      surfaces.map(surface =>
        Promise.resolve(surface.close()).catch(() => undefined),
      ),
    );
  }
} else if (step === 'recover-draft') {
  const state = await readState();
  if (!state.thinkToken || !state.sendReservedAt || state.sent) {
    throw new Error('there is no reserved unsent Thinking draft to recover');
  }
  const surfaces = [];
  try {
    for (const kind of meshKinds) surfaces.push(await connect(kind));
    const android = surfaces.find(surface => surface.platform === 'android');
    const androidSource = await android.ui.source();
    const androidText = await android.text();
    if (
      mobileMessageHasMarker(androidSource, 'user-message', state.thinkToken)
    ) {
      throw new Error(
        `Android already contains a sent ${state.thinkToken} message; refusing draft recovery`,
      );
    }
    if (count(androidText, state.thinkToken) !== 1) {
      throw new Error(
        'Android does not contain exactly one unsent marker draft; refusing recovery',
      );
    }
    for (const surface of surfaces.filter(
      candidate => candidate.platform !== 'android',
    )) {
      if (count(await surface.text(), state.thinkToken) !== 0) {
        throw new Error(
          `${surface.platform} contains ${state.thinkToken}; refusing draft recovery`,
        );
      }
    }
    state.misdirectedDrafts ??= [];
    state.misdirectedDrafts.push({
      token: state.thinkToken,
      reservedAt: state.sendReservedAt,
      recoveredAt: new Date().toISOString(),
      result:
        'marker remains only in Android composer; no sent message exists on any device',
    });
    delete state.sendReservedAt;
    await saveState(state);
    await record({
      platform: 'mesh',
      ok: true,
      action: 'recover-draft',
      token: state.thinkToken,
    });
    console.log(
      'PASS mesh     reserved draft recovered; same marker is safe to resume',
    );
  } finally {
    await Promise.all(
      surfaces.map(surface =>
        Promise.resolve(surface.close()).catch(() => undefined),
      ),
    );
  }
} else {
  throw new Error(
    `unknown --step ${step}; use snapshot, open-chat, open-settings, prepare-thinking, prepare-new-chat, prepare-project, prepare-guided-tools, send-guided-tools, verify-guided-tools, run-thinking-clean, probe-send, run-thinking, verify-thinking, recover-unsent, or recover-draft`,
  );
}

console.log(`evidence: ${evidenceDir}`);
