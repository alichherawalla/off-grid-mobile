# Brief: drive the Off Grid mesh E2E suite from iOS

You are running the physical-device E2E suite in `/Users/user/wednesday/off-grid-ai/mobile`
(branch `release/sync-feedback`), with the **iPhone as the producer** and the other devices as
observers. Everything below was learned on the hardware; each fact cost real time to find, so read
it before you touch anything.

## The rule that matters most

**Do not reset, delete, stash, or force-push anything.** Every repo in
`/Users/user/wednesday/off-grid-ai` holds unrelated in-progress work. Commit only files you changed
yourself, and only when the change is finished.

Report status as a gate — *code / wired / verified*. A journey is not passing until you have watched
it pass. Do not report a run as green because it "should" be.

## The four devices

| Surface | How it is reached | Notes |
|---|---|---|
| iPhone | WebDriverAgent on the phone's OWN address, currently `http://192.168.1.14:8100` | iPhone 17 Pro Max, UDID `4CF4A291-280A-598C-8AC5-851073C14B30`, app `ai.offgridmobile.dev` |
| Android | adb + Appium (`http://127.0.0.1:4723`) | serial `505b53a0`, package `ai.offgridmobile.dev` |
| macOS | Chrome DevTools Protocol on `http://127.0.0.1:9222` | the Electron app running on this Mac |
| Windows | CDP on `http://127.0.0.1:9224` | an SSH tunnel to `oga@192.168.1.26`; the port is bound to localhost ON the Windows box, so `192.168.1.26:9224` will look dead. Check the tunnel with `pgrep -fl "ssh.*9224"` |

Confirm all four before a long run. A journey that dies 20 minutes in because a surface was down
wastes the run and reads like a product failure.

## Bringing WebDriverAgent up

```bash
cd /Users/user/wednesday/off-grid-ai/mobile
WDA_UDID=4CF4A291-280A-598C-8AC5-851073C14B30 nohup node scripts/ios/launch-wda.mjs > /tmp/wda.log 2>&1 &
```

- **The launcher process IS the server.** If it exits, WDA dies. Do not run it in a foreground shell
  that will be torn down.
- `setsid` does **not** exist on macOS — `nohup` alone.
- It prints `WDA serving at http://<phone-ip>:8100`. The IP can change; read it from the log rather
  than assuming.
- **The phone must be UNLOCKED with Auto-Lock set to Never**, or WDA is suspended mid-run.
- Build + install + launch takes a few minutes. Wait for `/status` to answer.

### After any WDA restart, create a session FIRST

The rig's `WdaClient.attach()` deliberately *reuses* an existing session so it never relaunches the
app and loses its mesh identity. A freshly started WDA has no session, and you get
`WDA has no active session to attach to`. Create one:

```bash
curl -s -X POST http://<phone-ip>:8100/session \
  -H 'Content-Type: application/json' \
  -d '{"capabilities":{"alwaysMatch":{"bundleId":"ai.offgridmobile.dev","shouldWaitForQuiescence":false}}}'
```

## The suite

Everything modified **14 Aug 2026 or later** is the active mesh suite. The older files (11 Aug) are
the separate sync/pairing suite and are not part of this job.

| Journey | What it proves | iOS-primary state |
|---|---|---|
| `attended-thinking-sync` | staged: normal message, thinking on/off, project + Knowledge Base, guided six-tool run | `run-normal` **works** (fixed); `send-guided-tools` already had an iOS path; `prepare-project` **blocked** (see below) |
| `generated-image-sync` | image generation from a text prompt | **Android-hardcoded** — needs the same treatment as `run-normal` |
| `vision-image-sync` | attach a photo, describe it, generate from what was read | **Android-hardcoded** (adb + Appium + the Android photo picker) |
| `vision-answer-sync` | attach a photo, text answer only, no image | **Android-hardcoded**, same reason |

`attended-thinking-sync` is staged on purpose: one visible action per command, with the send guarded
by durable state so a rerun after a UI failure cannot submit the same prompt twice.

### Running the staged journey

```bash
RUN=iosnormal$(date +%s)
node scripts/e2e/attended-thinking-sync.mjs --step snapshot     --run $RUN --primary ios --ios http://<phone-ip>:8100 --mesh ios,android,macos
node scripts/e2e/attended-thinking-sync.mjs --step run-normal   --run $RUN --primary ios --ios http://<phone-ip>:8100 --mesh ios,android,macos
node scripts/e2e/attended-thinking-sync.mjs --step verify-normal --run $RUN --primary ios --ios http://<phone-ip>:8100 --mesh ios,android,macos
```

- `--mesh` narrows the run to devices that are genuinely available; excluded ones are printed.
- `--step open-chat` re-opens an **existing** conversation. It fails on a fresh marker, which is
  expected — `run-normal` is what creates the chat.
- Keep the same `$RUN` across every step; the state file is keyed on it.

## What was already fixed (do not redo)

1. **`run-normal` now honours `--primary`.** It used to find the surface named `android` and dispatch
   through Appium unconditionally, so `--primary ios` was accepted, validated, and then ignored —
   the "iOS" run went out from the Android phone. `openNewAndroidChat` / `setAndroidThinking` are now
   `openNewPrimaryChat` / `setPrimaryThinking`, named for the role, because they always spoke the
   shared label vocabulary.
2. **`--mesh` no longer lies.** It printed the exclusion and then ran every device anyway.
3. **iOS quick-settings accessibility.** The popover's inner `TouchableWithoutFeedback` merged all
   five rows into one element named `", Image Gen, Auto, , Thinking, ON, ..."`, so
   `quick-thinking-toggle` did not exist as an addressable control. Fixed with `accessible={false}`.
   This was a real VoiceOver defect, not only a test problem.

## Known open problems — reproduce before theorising

- **macOS `synced chat` times out at 90s.** In one observed case the very same conversation passed
  when `verify-normal` was re-run immediately afterwards, and the conversation was visibly present
  in the macOS sidebar with a completed reply. So the likely story is that macOS takes longer than
  90s to surface a chat synced from iOS, not that it never does. **Confirm this before changing the
  timeout** — if macOS really is that slow to show a synced conversation, the timeout is the symptom
  and the latency is the bug.
- **Windows did not receive an iOS-originated conversation at all**, while iOS, Android and macOS
  all had it. Its Devices panel showed `7 nearby / 3 connected`, so it is on the mesh. Worth its own
  investigation.
- **`prepare-project` cannot stage files on iOS.** `stageProjectFixtures` throws for any non-Android
  device: it uses `adb push` to put the fixture PDFs on the phone. The note in the code is accurate —
  the UI journey is platform-agnostic, only file staging is not. iOS needs a real seeding path (the
  app's Documents container via `devicectl`, or the Files app).

## Device-driving facts that will otherwise cost you hours

- **Appium and `adb shell uiautomator dump` cannot both own UiAutomator.** One instance exists on the
  device, so an open Appium session makes every adb dump fail — and it reads as a wedged phone rather
  than a driver collision. Hold the Appium session only around the steps that need it.
- **Relaunch the app BEFORE walking back.** Pressing back until a screen appears walks straight out
  to the launcher, where none of the app's screens exist and every further press is wasted.
- **Start from a fresh chat.** A long transcript is unreadable to the dump.
- **Put the run marker at the START of a prompt.** Peers find the conversation by its chat-list
  preview, which truncates — a marker at the end of a long prompt never reaches them, and every
  observer times out on a conversation that synced perfectly well.
- **Background commands reset the working directory.** `cd` inside the backgrounded command itself.
- **Never dump a whole page's text through CDP.** Query for the specific booleans or short strings
  you need.

## Still to build (requested, not started)

- Multiple attachments in one turn — pdf + text + image on a single message. This is the **composer**
  path, distinct from the project Knowledge Base path that `prepare-project` already covers.
- A camera capture instead of a photo-library pick.

## House rules

- Read `rules.md` in full first — it is the single source of truth for this repo.
- **Do not write tests unless explicitly asked.** The standard here is: finish the source change,
  verify it by hand on the real device, and only then write tests when asked for them.
- Evidence (screenshots, `result.json`, the action ndjson) lands under `.artifacts/e2e-flows/`.
  Cite it when you report a result.
