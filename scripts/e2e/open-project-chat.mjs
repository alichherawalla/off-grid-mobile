import { flag, specFor } from './mesh-config.mjs';
import { connectSurface } from './sync-surface.mjs';

const platform = flag('platform', '');
const project = flag('project', '');
const chat = flag('chat', 'New Conversation');

if (!['android', 'ios', 'macos', 'windows'].includes(platform)) {
  throw new Error('--platform must be android, ios, macos, or windows');
}
if (!project) throw new Error('--project is required');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const surface = await connectSurface({ ...specFor(platform), passive: false });

const openMobile = async () => {
  let labels = await surface.ui.labels();
  if (
    labels.includes('chat-screen') &&
    labels.some(label => label.includes(project)) &&
    labels.some(label => label.trim() === chat)
  )
    return;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    labels = await surface.ui.labels();
    if (labels.includes('projects-screen')) break;
    if (labels.includes('projects-tab'))
      await surface.ui.tapLabel('projects-tab');
    else await surface.ui.back();
    await sleep(500);
  }
  await surface.ui.waitForLabel('projects-screen', {
    label: `${platform} Projects`,
    timeoutMs: 20_000,
  });
  await surface.ui.scrollToLabel(project, { maxSwipes: 12 });
  await surface.ui.tapLabel(project);
  await surface.ui.waitForLabel('project-detail-screen', {
    label: `${platform} project detail`,
    timeoutMs: 20_000,
  });
  await surface.ui.tapWhenReady(chat, {
    label: `${platform} project chat`,
    timeoutMs: 20_000,
  });
  await surface.ui.waitForLabel('chat-screen', {
    label: `${platform} project chat screen`,
    timeoutMs: 20_000,
  });
};

const openDesktop = async () => {
  await surface.ui.click('Projects');
  await sleep(300);
  if (!(await surface.ui.click(project)))
    throw new Error(`${platform} does not show project ${project}`);
  await surface.ui.waitFor(async () => (await surface.text()).includes(chat), {
    label: `${platform} project chat row`,
    timeoutMs: 20_000,
    intervalMs: 300,
  });
  const opened = await surface.ui.evaluate(`
    const wanted = ${JSON.stringify(chat)};
    const leaves = [...document.querySelectorAll('div.truncate.text-sm.text-neutral-200')]
      .filter((node) =>
        node.children.length === 0 &&
        node.offsetParent !== null &&
        (node.textContent || '').trim() === wanted
      );
    // Project chats are newest-first. Select the first exact title instead of an older blank chat
    // that can have the same default title.
    const leaf = leaves[0];
    const owner = leaf?.closest('button, [role="button"], .cursor-pointer');
    if (!owner) return false;
    owner.click();
    return true;
  `);
  if (!opened) throw new Error(`${platform} does not show chat ${chat}`);
  await surface.ui.waitFor(
    () =>
      surface.ui.evaluate(`
      const composer = document.querySelector(
        'textarea, input[placeholder*="Ask" i], [contenteditable="true"]',
      );
      return Boolean(
        composer &&
        composer.offsetParent !== null &&
        document.body.innerText.includes(${JSON.stringify(chat)}) &&
        document.body.innerText.includes(${JSON.stringify(project)})
      );
    `),
    {
      label: `${platform} open project chat`,
      timeoutMs: 20_000,
      intervalMs: 300,
    },
  );
};

try {
  if (surface.family === 'rn') await openMobile();
  else await openDesktop();

  const text = await surface.text();
  if (!text.includes(project) || !text.includes(chat)) {
    throw new Error(`${platform} does not show the expected project chat`);
  }
  console.log(`PASS ${platform.padEnd(8)} ${chat} in ${project}`);
} finally {
  await Promise.resolve(surface.close()).catch(() => undefined);
}
