/**
 * The uiautomator XML parser, which is the one piece of the Android driver that can fail silently.
 *
 * If it mis-parses, nothing throws - findByLabel simply returns null or, worse, returns an element whose centre
 * is somewhere else, and the test fails later with a locator that "mysteriously" does not match. So the shape it
 * produces is asserted directly: the WDA node shape, the bounds arithmetic, the nesting, and which attribute
 * wins as the label.
 *
 * Run: node --test scripts/android/__tests__/adbClient.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUiAutomatorXml } from '../adb-client.mjs';

/** A trimmed dump in the exact shape uiautomator emits: self-closing leaves, nested containers, real bounds. */
const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="ai.offgridmobile.dev" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" class="android.view.ViewGroup" resource-id="ai.offgridmobile.dev:id/root" content-desc="home-screen" bounds="[0,100][1080,2300]">
      <node index="0" class="android.widget.TextView" text="Off Grid AI" content-desc="" bounds="[40,140][500,200]" />
      <node index="1" class="android.widget.Button" content-desc="settings-tab" text="Settings" bounds="[100,2200][300,2280]" />
    </node>
  </node>
</hierarchy>`;

const flatten = (node, out = []) => {
  out.push(node);
  (node.children ?? []).forEach((child) => flatten(child, out));
  return out;
};

test('normalises bounds into an x/y/width/height rect', () => {
  const nodes = flatten(parseUiAutomatorXml(DUMP));
  const button = nodes.find((n) => n.label === 'settings-tab');

  // [100,2200][300,2280] is corner-to-corner on Android; the rest of the harness reasons about size, and taps
  // the centre. Get this subtraction wrong and every tap lands off-target while every locator still "matches".
  assert.deepEqual(button.rect, { x: 100, y: 2200, width: 200, height: 80 });
});

test('keeps the tree nested rather than flattening it', () => {
  const root = parseUiAutomatorXml(DUMP);

  const frame = root.children[0];
  const group = frame.children[0];
  assert.equal(root.children.length, 1);
  assert.equal(frame.type, 'android.widget.FrameLayout');
  assert.equal(group.label, 'home-screen');
  // Two leaves under the group - a flattened parse would put them at the top and break any scoped search.
  assert.equal(group.children.length, 2);
});

test('prefers content-desc as the label, because that is where testID lands', () => {
  const nodes = flatten(parseUiAutomatorXml(DUMP));

  // React Native maps accessibilityLabel and testID onto content-desc. Taking `text` instead would make tests
  // target user-visible copy, which changes for product reasons and is translated.
  const byTestId = nodes.find((n) => n.label === 'settings-tab');
  assert.equal(byTestId.value, 'Settings', 'the visible text is still available as value');
  assert.equal(byTestId.name, '', 'no resource-id on this one');

  const byResourceId = nodes.find((n) => n.name.endsWith(':id/root'));
  assert.equal(byResourceId.label, 'home-screen');
});

test('carries visible text through for nodes that only have text', () => {
  const nodes = flatten(parseUiAutomatorXml(DUMP));
  const title = nodes.find((n) => n.value === 'Off Grid AI');

  assert.equal(title.label, '', 'no content-desc on a plain TextView');
  assert.deepEqual(title.rect, { x: 40, y: 140, width: 460, height: 60 });
});

test('survives a dump with no nodes at all', () => {
  // A locked screen, or a dump taken while the window was gone. An empty tree is a valid answer; a throw here
  // would turn a retryable poll into a failed run.
  const root = parseUiAutomatorXml("<?xml version='1.0'?><hierarchy rotation='0' />");

  assert.deepEqual(root.children, []);
});

test('survives truncated XML instead of throwing', () => {
  // adb output does get cut off. waitFor() polls, so returning what was parsed lets the next poll succeed;
  // throwing from the parser would abort the whole run on a transient read.
  const truncated = DUMP.slice(0, DUMP.indexOf('settings-tab'));

  const nodes = flatten(parseUiAutomatorXml(truncated));

  assert.ok(nodes.some((n) => n.label === 'home-screen'), 'what did arrive is still usable');
});

test('ignores attribute values that contain brackets', () => {
  // Labels are user data. A label like "Sent [2] files" must not be mistaken for a bounds pair.
  const dump = `<hierarchy><node class="X" content-desc="Sent [2] files" bounds="[10,20][30,60]" /></hierarchy>`;

  const [node] = parseUiAutomatorXml(dump).children;

  assert.equal(node.label, 'Sent [2] files');
  assert.deepEqual(node.rect, { x: 10, y: 20, width: 20, height: 40 });
});

test('decodes XML entities before a semantic label is matched', () => {
  const dump = '<hierarchy><node class="X" content-desc="Date &amp; Time, OFF" bounds="[0,0][100,50]" /></hierarchy>';

  const [node] = parseUiAutomatorXml(dump).children;

  assert.equal(node.label, 'Date & Time, OFF');
});
