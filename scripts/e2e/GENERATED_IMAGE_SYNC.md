# Android to mesh image test

This physical test starts image generation on Android. It then checks the same journey on Android,
iOS, macOS, and Windows.

It verifies:

- the synced chat opens without an app restart;
- a live Enhancing, Loading image model, or Generating image state appears;
- the live state ends when the saved result arrives;
- the prompt and one decoded image are in one message bubble;
- `Image arriving` does not remain;
- the new decoded image appears in Gallery;
- screenshots and a JSON result are saved for every device.

## Preconditions

- All devices are already paired and connected on the mesh.
- Android is visible to `adb`.
- WebDriverAgent is available at `WDA_URL` for the iPhone.
- Off Grid Desktop runs with CDP on local port 9222 for macOS.
- The Windows CDP tunnel uses local port 9224.
- Android has an image model downloaded. The test selects it through forced image mode.

Run this command on the Mac that owns the device-control channels:

```sh
npm run e2e:image-sync
```

The default mesh is `ios,macos,windows`. Use a smaller observer set only for diagnosis:

```sh
npm run e2e:image-sync -- --mesh ios,macos --timeout-minutes 30
```

The run does not pair, forget, disconnect, restart, or change mesh membership. Evidence is written to
`.artifacts/e2e-flows/generated-image-sync/`.

## Reliable physical-device setup

Use this setup before the first app action. Do not let the journey runner discover devices by trial
and error.

### 1. Confirm the four apps

- Keep Android, iOS, macOS Desktop, and Windows Desktop open.
- Keep the iPhone unlocked. Accept the iOS trust prompt and enter the trust code when iOS asks.
- Confirm Android is visible before opening or creating a chat:

```sh
adb devices -l
adb -s 505b53a0 shell pidof ai.offgridmobile.dev
```

### 2. Start WebDriverAgent on the correct iPhone

Do not run the launcher without `WDA_UDID` when `xctrace` lists this Mac as a device. The automatic
selection can choose the Mac instead of the iPhone.

Find the available paired iPhone:

```sh
xcrun devicectl list devices
xcrun xctrace list devices
```

Start WDA with the physical iPhone UDID printed by `xctrace`:

```sh
cd mobile
WDA_UDID=<physical-iphone-udid> node scripts/ios/launch-wda.mjs
```

Leave that process running. It prints the device URL, for example:

```text
WDA_URL=http://192.168.1.14:8100
```

Verify the URL before the journey:

```sh
curl -fsS "$WDA_URL/status"
```

The result must say `ready: true`. If `xcodebuild` exits before WDA serves, keep the phone unlocked,
accept its trust prompt, and run the explicit `xcodebuild test-without-building` command once to see
the device error. Do not navigate in Off Grid while repairing WDA.

### 3. Start both Desktop apps with CDP

Run macOS Desktop on the Mac that owns the device controls:

```sh
cd desktop
npm run dev -- --remoteDebuggingPort 9222
curl -fsS http://127.0.0.1:9222/json/list
```

Run one Windows Desktop dev process in the Windows VM:

```powershell
cd C:\Users\oga\ogad-git
npm run dev -- --remoteDebuggingPort 9224
```

Do not start a second dev process. Stop old `node`, `electron`, or `llama-server` processes first if
Windows reports `EADDRINUSE`.

Before starting Windows, follow `REMOTE_WINDOWS_DEV_MIRROR.md`. Hash at least the Shared `models`
and `sync` package entry files on both machines. A missing `@offgrid/models/dist/index.js` means the
Windows Shared mirror is stale; restarting the app alone cannot repair it.

### 4. Check all control channels

Run these checks before any chat action:

```sh
adb devices -l
curl -fsS "$WDA_URL/status"
curl -fsS http://127.0.0.1:9222/json/list
curl -fsS http://127.0.0.1:9224/json/list
```

Do not send a prompt when one channel is missing. Repair the control channel first.

## Safe staged journey

### Source-first selectors

Before automating any control, read the component source and use its owned `testID` or accessibility
identifier. Do not infer a selector from visible copy, an icon glyph, accessibility-tree order, or a
screen coordinate. For example, the Android chat Send icon is owned by
`src/components/ChatInput/index.tsx` and uses `testID="send-button"`; the E2E clicks that element
through Appium UiAutomator2.

If a required control has no stable identifier, add one in the component source first. Then rebuild
the app and use that identifier in the journey.

Use the staged journey for an attended physical test. The one-shot command is for a fully proven
setup only.

- Create one uniquely named E2E chat.
- Wait until that same chat appears once on all four devices.
- Open it once on iOS and keep iOS on that chat.
- Record the starting message and Gallery counts.
- Arm all observers before Android sends.
- Send one unique image prompt from Android exactly once.
- Never retry the send action automatically after a timeout or navigation error.
- Do not create a replacement chat after a failure.
- Do not press Back on iOS while live or final chat verification is in progress.
- Verify the live state and final decoded image in the chat first.
- Verify Gallery later as a separate action. A Gallery navigation failure must not restart the chat
  journey or resend the prompt.
- Stop at the first failed visible action. Capture the current screen and report the exact platform
  and phase before any recovery action.

This staged order prevents a failed iOS Back action from creating repeated chats or repeated image
requests.

### Replay an attended Thinking checkpoint

Use the staged Thinking runner after the normal Text checkpoint exists. Every command records the UI
text and a screenshot before and after its action. It also appends an action ledger and keeps durable
journey state in the checkpoint evidence directory.

```sh
npm run e2e:thinking-sync -- \
  --step snapshot \
  --run <checkpoint-marker> \
  --ios http://<iphone-ip>:8100

npm run e2e:thinking-sync -- \
  --step open-chat \
  --run <checkpoint-marker> \
  --ios http://<iphone-ip>:8100

npm run e2e:thinking-sync -- \
  --step open-settings \
  --run <checkpoint-marker> \
  --ios http://<iphone-ip>:8100

npm run e2e:thinking-sync -- \
  --step prepare-thinking \
  --run <checkpoint-marker> \
  --ios http://<iphone-ip>:8100

npm run e2e:thinking-sync -- \
  --step run-thinking \
  --run <checkpoint-marker> \
  --ios http://<iphone-ip>:8100
```

Use `--step probe-send` before the first live run on a new Android build. It resolves
`testID="send-button"`, records the native node attributes and screenshot, and does not click it.
If the Text turn has no selected text model, Send intentionally opens `ModelSelectorModal` and saves
the draft as pending. The runner selects Qwen through
`testID="text-model-row-unsloth/Qwen3.5-0.8B-GGUF"`; `handleModelSelect` then resumes the pending turn
once. Do not use the header's `model-selector` for this: that identifier opens Models Manager.

Run one step at a time until the route is proven. The runner opens only the chat whose marker was
passed in `--run`; it does not create a replacement chat. Add `--platform android`, `ios`, `macos`,
or `windows` to stage one device at a time. `run-thinking` reserves its unique send in
`thinking-state.json` before it taps Send and refuses a second send after a failure or rerun.
If a control-channel failure misdirects the tap, run `--step recover-unsent`. Recovery succeeds only
when the marker is absent on all four devices and Android is on the clean checkpoint chat.
If the marker remains only as an Android composer draft, use `--step recover-draft`. It preserves the
draft and clears the reservation only after it proves no sent message exists on any device.
